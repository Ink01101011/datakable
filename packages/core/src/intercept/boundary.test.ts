import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatakableConfigError, DatakableError, throwConfigError } from '../diagnostics/build'
import { createDiagnostics, type DiagnosticsOptions } from '../diagnostics/hub'
import type { Diagnostic } from '../diagnostics/types'
import { errorBoundary } from './boundary'
import { CallbackError, callUser, classifyError } from './classify'
import { type ContextBase, createContext } from './context'
import { defineInterceptor, type Interceptor } from './define'
import { FALLBACK, getFallback, registerFallback } from './fallbacks'
import { type OpInput, type OpName, registerOperation } from './operations'
import { createInterceptorRuntime } from './runtime'

declare module './operations' {
  interface Operations {
    'test:no-fallback': { kind: 'sync'; input: undefined; output: number | undefined }
    'test:own-fallback': { kind: 'sync'; input: undefined; output: number }
  }
}
registerOperation('test:no-fallback', { kind: 'sync', hot: false })
registerOperation('test:own-fallback', { kind: 'sync', hot: false })

afterEach(() => {
  vi.restoreAllMocks()
})

/** A table-like setup: hub + runtime + boundary, collecting every delivered diagnostic. */
function setup(o: DiagnosticsOptions & { interceptors?: Interceptor<OpName>[] } = {}) {
  const seen: Diagnostic[] = []
  const hub = createDiagnostics({
    console: false,
    onDiagnostic: (d) => seen.push(d),
    ...o,
  })
  const rt = createInterceptorRuntime({ emit: hub.emit, interceptors: o.interceptors ?? [] })
  hub.attach(rt)
  rt.installBoundary(errorBoundary)
  const base: ContextBase = {
    table: undefined,
    run: 7,
    trigger: 'init',
    phase: 'client',
    emit: hub.emit,
  }
  const ctx = <O extends OpName>(op: O, input: OpInput<O>, where = 'core') =>
    createContext(op, input, where, base)
  return { hub, rt, seen, ctx }
}

/** An error whose top frame is user code, not DataKable. */
const foreign = (message = 'user bug') => {
  const e = new TypeError(message)
  e.stack = `TypeError: ${message}\n    at render (/app/src/UsersPage.tsx:10:5)\n    at x (/app/node_modules/react/index.js:1:1)`
  return e
}
/** An error whose top frame is DataKable code. */
const own = (message = 'core bug') => {
  const e = new TypeError(message)
  e.stack = `TypeError: ${message}\n    at runStep (/app/node_modules/@datakable/core/dist/index.js:120:7)`
  return e
}

describe('classifyError', () => {
  it('CallbackError → DK_CALLBACK_FAILED; own top frame → DK_INTERNAL; else DK_UNKNOWN', () => {
    expect(classifyError(new CallbackError('columns[0].format', new Error('x')))).toBe(
      'DK_CALLBACK_FAILED',
    )
    expect(classifyError(own())).toBe('DK_INTERNAL')
    expect(classifyError(foreign())).toBe('DK_UNKNOWN')
    expect(classifyError('a string')).toBe('DK_UNKNOWN')
    expect(classifyError(undefined)).toBe('DK_UNKNOWN')
    expect(classifyError({ stack: 42 })).toBe('DK_UNKNOWN')
  })

  it('reads the top frame in the Firefox / Safari format too', () => {
    const e = new Error('x')
    e.stack = 'runStep@https://cdn.example/npm/@datakable/core@1.0.0/dist/index.js:1:2\n'
    expect(classifyError(e)).toBe('DK_INTERNAL')
    e.stack = 'render@https://example.com/app.js:1:2\nrun@https://cdn/@datakable/core/x.js:1:1'
    expect(classifyError(e)).toBe('DK_UNKNOWN')
  })

  it('callUser wraps a throw in CallbackError with the slot and row; passes results through', () => {
    expect(callUser('fetcher', (n: number) => n + 1, 1)).toBe(2)
    const cause = new Error('boom')
    let caught: unknown
    try {
      callUser(
        'columns[1].sortFn',
        () => {
          throw cause
        },
        0,
        4,
      )
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(CallbackError)
    expect((caught as CallbackError).slot).toBe('columns[1].sortFn')
    expect((caught as CallbackError).row).toBe(4)
    expect((caught as CallbackError).cause).toBe(cause)
  })
})

describe('errorBoundary — throw in any op → code + where + registry fallback', () => {
  it('pipeline:step: unknown throw → DK_UNKNOWN at op + slot, step passes its input through', () => {
    const { rt, seen, ctx } = setup()
    const indices = new Uint32Array([3, 1, 2])
    const out = rt.run(
      'pipeline:step',
      ctx('pipeline:step', { stage: 'sort', feature: 'sorting', indices }, 'features.sorting'),
      () => {
        throw foreign()
      },
    )
    expect(out).toBe(indices)
    expect(seen).toHaveLength(1)
    const d = seen[0] as Diagnostic
    expect(d.code).toBe('DK_UNKNOWN')
    expect(d.level).toBe('error')
    expect(d.where).toEqual({ kind: 'operation', op: 'pipeline:step', slot: 'features.sorting' })
    expect(d.impact).toMatch(/passed its input through/)
    expect(d.fix.length).toBeGreaterThan(0)
    expect(d.context.cause).toBeInstanceOf(TypeError)
    expect(d.context.run).toBe(7)
  })

  it('DataKable-code throw → DK_INTERNAL with a prefilled issue link', () => {
    const { rt, seen, ctx } = setup()
    rt.run('state:dispatch', ctx('state:dispatch', { updater: 1 }, 'setState'), () => {
      throw own('cannot read x')
    })
    const d = seen[0] as Diagnostic
    expect(d.code).toBe('DK_INTERNAL')
    expect(d.where).toEqual({ kind: 'operation', op: 'state:dispatch', slot: 'setState' })
    expect(d.problem).toMatch(/likely a DataKable bug/)
    expect(d.problem).toMatch(/TypeError/)
    expect(d.impact).toMatch(/state unchanged/)
    const link = d.fix.find((f) => f.includes('issues/new?'))
    expect(link).toBeDefined()
    expect(decodeURIComponent(link as string)).toMatch(/state:dispatch/)
  })

  it('CallbackError → DK_CALLBACK_FAILED, where = the slot, rows = the row', () => {
    const { rt, seen, ctx } = setup()
    rt.run(
      'pipeline:step',
      ctx('pipeline:step', { stage: 'sort', feature: 'sorting', indices: new Uint32Array(2) }),
      () =>
        callUser(
          'columns[2].sortFn',
          () => {
            throw new RangeError('nope')
          },
          undefined,
          5,
        ),
    )
    const d = seen[0] as Diagnostic
    expect(d.code).toBe('DK_CALLBACK_FAILED')
    expect(d.where).toEqual({ kind: 'option', path: 'columns[2].sortFn' })
    expect(d.details).toMatchObject({
      slot: 'columns[2].sortFn',
      rows: [5],
      count: 1,
      errorName: 'RangeError',
    })
    expect(d.context.cause).toBeInstanceOf(RangeError)
  })

  it('built-in fallbacks: every op has a registry entry with a description', () => {
    for (const op of [
      'table:init',
      'table:setOptions',
      'table:destroy',
      'state:dispatch',
      'data:ingest',
      'pipeline:run',
      'pipeline:step',
      'column:batch',
      'async:request',
      'diagnostic:emit',
    ] as const) {
      expect(getFallback(op).describe.length, op).toBeGreaterThan(0)
    }
  })

  it('data:ingest keeps the previous data (FALLBACK meta), else []', () => {
    const { rt, ctx } = setup()
    const prev = [{ id: 1 }]
    const c = ctx('data:ingest', { data: [{ id: 2 }] })
    c.meta.set(FALLBACK, prev)
    expect(
      rt.run('data:ingest', c, () => {
        throw foreign()
      }),
    ).toBe(prev)
    expect(
      rt.run('data:ingest', ctx('data:ingest', { data: [] }), () => {
        throw foreign()
      }),
    ).toEqual([])
  })

  it('pipeline:run keeps the last good row model, else all rows in order', () => {
    const { rt, ctx } = setup()
    const last = new Uint32Array([4, 2])
    const c = ctx('pipeline:run', { rowCount: 3 })
    c.meta.set(FALLBACK, last)
    expect(
      rt.run('pipeline:run', c, () => {
        throw foreign()
      }),
    ).toBe(last)
    expect(
      rt.run('pipeline:run', ctx('pipeline:run', { rowCount: 3 }), () => {
        throw foreign()
      }),
    ).toEqual(new Uint32Array([0, 1, 2]))
  })

  it('table:* and state:dispatch return undefined; column:batch returns undefined', () => {
    const { rt, seen, ctx } = setup()
    expect(
      rt.run('table:setOptions', ctx('table:setOptions', { options: {}, previous: {} }), () => {
        throw foreign()
      }),
    ).toBeUndefined()
    expect(
      rt.run(
        'column:batch',
        ctx(
          'column:batch',
          { column: 'price', slot: 'format', rows: new Uint32Array(1) },
          'columns[1].format',
        ),
        () => {
          throw foreign()
        },
      ),
    ).toBeUndefined()
    expect(seen.map((d) => d.code)).toEqual(['DK_UNKNOWN', 'DK_UNKNOWN'])
    expect(seen[1]?.where).toEqual({
      kind: 'operation',
      op: 'column:batch',
      slot: 'columns[1].format',
    })
  })

  it('async:request: a rejection resolves to the previous results; a sync throw too', async () => {
    const { rt, seen, ctx } = setup()
    const c = ctx('async:request', { source: 'fetcher' }, 'fetcher')
    c.meta.set(FALLBACK, ['prev'])
    await expect(rt.run('async:request', c, () => Promise.reject(foreign()))).resolves.toEqual([
      'prev',
    ])
    const c2 = ctx('async:request', { source: 'searchFn' }, 'searchFn')
    await expect(
      rt.run('async:request', c2, () => {
        throw new CallbackError('searchFn', new Error('x'))
      }),
    ).resolves.toBeUndefined()
    expect(seen.map((d) => d.code)).toEqual(['DK_UNKNOWN', 'DK_CALLBACK_FAILED'])
  })

  it('data:ingest async rejection is caught too', async () => {
    const { rt, seen, ctx } = setup()
    const c = ctx('data:ingest', { data: [] })
    c.meta.set(FALLBACK, [1])
    await expect(
      rt.run('data:ingest', c, async () => {
        throw foreign()
      }),
    ).resolves.toEqual([1])
    expect(seen[0]?.code).toBe('DK_UNKNOWN')
  })

  it('a successful op passes through untouched (same reference, no diagnostic)', async () => {
    const { rt, seen, ctx } = setup()
    const out = new Uint32Array([1])
    expect(
      rt.run(
        'pipeline:step',
        ctx('pipeline:step', { stage: 's', feature: 'f', indices: out }),
        () => out,
      ),
    ).toBe(out)
    const p = rt.run('async:request', ctx('async:request', { source: 'fetcher' }), async () => 'ok')
    await expect(p).resolves.toBe('ok')
    expect(seen).toEqual([])
  })

  it('an op without a registered fallback returns undefined; a registered one is used', () => {
    const { rt, seen, ctx } = setup()
    expect(
      rt.run('test:no-fallback', ctx('test:no-fallback', undefined), () => {
        throw foreign()
      }),
    ).toBeUndefined()
    registerFallback('test:own-fallback', { describe: 'returned -1', value: () => -1 })
    expect(
      rt.run('test:own-fallback', ctx('test:own-fallback', undefined), () => {
        throw foreign()
      }),
    ).toBe(-1)
    expect(seen[1]?.impact).toMatch(/returned -1/)
  })

  it('an error inside an inner interceptor is still DK_INTERCEPTOR_FAILED, not the boundary', () => {
    const bad = defineInterceptor({
      name: 'bad',
      on: ['state:dispatch'],
      intercept() {
        throw new Error('x')
      },
    })
    const { rt, seen, ctx } = setup({ interceptors: [bad as Interceptor<OpName>] })
    let ran = false
    rt.run('state:dispatch', ctx('state:dispatch', { updater: 1 }), () => {
      ran = true
    })
    expect(ran).toBe(true)
    expect(seen.map((d) => d.code)).toEqual(['DK_INTERCEPTOR_FAILED'])
  })

  it('production: no text, but code + where + fallback still apply', () => {
    const { rt, seen, ctx } = setup({ dev: false })
    const indices = new Uint32Array([1])
    expect(
      rt.run('pipeline:step', ctx('pipeline:step', { stage: 's', feature: 'f', indices }), () => {
        throw foreign()
      }),
    ).toBe(indices)
    expect(seen[0]?.code).toBe('DK_UNKNOWN')
    expect(seen[0]?.problem).toBe('')
    expect(seen[0]?.where).toMatchObject({ kind: 'operation', op: 'pipeline:step' })
  })
})

describe('errorBoundary — DatakableError passes through', () => {
  it('DatakableConfigError from table:init is rethrown, not swallowed', () => {
    const { rt, seen, ctx } = setup()
    expect(() =>
      rt.run('table:init', ctx('table:init', { options: {} }), () =>
        throwConfigError('DK_OPERATION_CONFLICT', {
          op: 'x:y',
          kind: 'sync',
          hot: false,
          previousKind: 'async',
          previousHot: false,
        }),
      ),
    ).toThrow(DatakableConfigError)
    expect(seen).toEqual([])
  })

  it('strict: an error-level emit from inside an op throws DatakableError out of run', () => {
    const { rt, ctx } = setup({ strict: true })
    let caught: unknown
    try {
      rt.run(
        'pipeline:step',
        ctx('pipeline:step', { stage: 's', feature: 'f', indices: new Uint32Array(0) }),
        (c) => {
          c.emit('DK_INTERNAL', { op: 'pipeline:step', problem: 'invariant' })
          return c.input.indices
        },
      )
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(DatakableError)
    expect((caught as DatakableError).code).toBe('DK_INTERNAL')
  })

  it('strict: the boundary’s own error-level report throws DatakableError (not swallowed)', () => {
    const { rt, ctx } = setup({ strict: true })
    expect(() =>
      rt.run('state:dispatch', ctx('state:dispatch', { updater: 1 }), () => {
        throw foreign()
      }),
    ).toThrow(DatakableError)
  })

  it('strict: a failing diagnostic:emit interceptor surfaces DK_INTERCEPTOR_FAILED as DatakableError', () => {
    const broken = defineInterceptor({
      name: 'broken-logger',
      on: ['diagnostic:emit'],
      intercept() {
        throw new Error('boom')
      },
    })
    const { hub } = setup({ strict: true, interceptors: [broken as Interceptor<OpName>] })
    let caught: unknown
    try {
      hub.emit('DK_HOT_INTERCEPTOR', { interceptor: 'x', op: 'column:batch' }) // warn level
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(DatakableError)
    expect((caught as DatakableError).code).toBe('DK_INTERCEPTOR_FAILED')
  })

  it('non-strict: the same failing logger is swallowed', () => {
    const broken = defineInterceptor({
      name: 'broken-logger',
      on: ['diagnostic:emit'],
      intercept() {
        throw new Error('boom')
      },
    })
    const { hub, seen } = setup({ interceptors: [broken as Interceptor<OpName>] })
    expect(() =>
      hub.emit('DK_HOT_INTERCEPTOR', { interceptor: 'x', op: 'column:batch' }),
    ).not.toThrow()
    expect(seen.map((d) => d.code).sort()).toEqual(['DK_HOT_INTERCEPTOR', 'DK_INTERCEPTOR_FAILED'])
  })
})

describe('errorBoundary — diagnostic:emit', () => {
  it('a throwing redact step is swallowed with one console.error; emit returns undefined', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { hub, seen } = setup({
      redact: () => {
        throw new Error('redactor broke')
      },
    })
    expect(hub.emit('DK_HOT_INTERCEPTOR', { interceptor: 'x', op: 'column:batch' })).toBeUndefined()
    expect(hub.emit('DK_HOT_INTERCEPTOR', { interceptor: 'y', op: 'column:batch' })).toBeUndefined()
    expect(seen).toEqual([])
    expect(error).toHaveBeenCalledTimes(1)
  })
})

describe('errorBoundary — shape', () => {
  it('is named, attaches everywhere and accepts hot ops without a warning', () => {
    expect(errorBoundary.name).toBe('errorBoundary')
    expect(errorBoundary.on).toBe('*')
    expect(errorBoundary.hot).toBe(true)
    const onHotWarning = vi.fn()
    const rt = createInterceptorRuntime({ onHotWarning })
    rt.installBoundary(errorBoundary)
    expect(onHotWarning).not.toHaveBeenCalled()
  })

  it('survives setInterceptors (cannot be removed)', () => {
    const { rt, seen, ctx } = setup()
    rt.setInterceptors([])
    rt.run('state:dispatch', ctx('state:dispatch', { updater: 1 }), () => {
      throw foreign()
    })
    expect(seen[0]?.code).toBe('DK_UNKNOWN')
  })
})
