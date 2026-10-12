import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDiagnostics } from '../diagnostics/hub'
import type { Diagnostic } from '../diagnostics/types'
import { errorBoundary } from './boundary'
import { CellFailures, runCells } from './cell-batch'
import { callUser } from './classify'
import { type ContextBase, createContext } from './context'
import { defineInterceptor } from './define'
import { createInterceptorRuntime } from './runtime'

/**
 * Integration of T06 (errorBoundary codes) with T26 (redaction): errors thrown by user callbacks
 * or DataKable code often embed row values in their message (V8: `Cannot create property 'x' on
 * string '<value>'`). Under `'safe'` none of it may reach a diagnostic, except `context.cause`.
 */
const SENTINEL = 'alice@example.com'
const message = `Cannot create property 'x' on string '${SENTINEL}'`

const own = () => {
  const e = new TypeError(message)
  e.stack = `TypeError: ${message}\n    at runStep (/app/node_modules/@datakable/core/dist/index.js:1:2)`
  return e
}
const foreign = () => {
  const e = new TypeError(message)
  e.stack = `TypeError: ${message}\n    at render (/app/src/UsersPage.tsx:10:5)`
  return e
}

function exposed(d: Diagnostic): string {
  const { cause: _c, ...context } = d.context
  return [
    JSON.stringify(d),
    JSON.stringify(context),
    JSON.stringify(d.details),
    d.problem,
    d.impact,
    d.fix.join('\n'),
    decodeURIComponent(d.fix.join('\n')),
    d.docs,
    decodeURIComponent(d.docs),
    d.fingerprint,
  ].join('\n')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe.each([
  ['dev', true],
  ['prod', false],
])("boundary diagnostics under 'safe' (%s)", (_name, dev) => {
  function setup() {
    const spies = (['error', 'warn', 'info', 'log', 'groupCollapsed', 'group'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    )
    const seen: Diagnostic[] = []
    const chain: string[] = []
    const hub = createDiagnostics({
      name: 'UsersTable',
      dev,
      redaction: 'safe',
      onDiagnostic: (d) => seen.push(d),
    })
    const rt = createInterceptorRuntime({
      emit: hub.emit,
      interceptors: [
        defineInterceptor({
          name: 'audit',
          on: ['diagnostic:emit'],
          intercept(ctx, next) {
            chain.push(exposed(ctx.input.diagnostic), ctx.where)
            return next()
          },
        }),
      ],
    })
    hub.attach(rt)
    rt.installBoundary(errorBoundary)
    const base: ContextBase = {
      table: undefined,
      run: 1,
      trigger: 'init',
      phase: 'client',
      emit: hub.emit,
    }
    const logged = () =>
      spies
        .flatMap((s) => s.mock.calls)
        .map((c) => c.map(String).join(' '))
        .join('\n')
    return { hub, rt, seen, chain, base, logged }
  }

  const expectClean = (s: ReturnType<typeof setup>, code: string) => {
    expect(s.seen.map((d) => d.code)).toEqual([code])
    const d = s.seen[0] as Diagnostic
    expect(exposed(d)).not.toContain('alice')
    for (const x of s.hub.getDiagnostics()) expect(exposed(x)).not.toContain('alice')
    expect(s.chain.length).toBeGreaterThan(0)
    expect(s.chain.join('\n')).not.toContain('alice')
    expect(s.logged()).toContain(code)
    expect(s.logged()).not.toContain('alice')
    // The original error is kept for onDiagnostic only.
    expect(String((d.context.cause as Error).message)).toContain(SENTINEL)
  }

  it('DK_CALLBACK_FAILED (cold callback via callUser)', () => {
    const s = setup()
    s.rt.run('state:dispatch', createContext('state:dispatch', {} as never, 'core', s.base), () =>
      callUser(
        'onStateChange',
        () => {
          throw foreign()
        },
        undefined,
      ),
    )
    expectClean(s, 'DK_CALLBACK_FAILED')
  })

  it('DK_CALLBACK_FAILED (column:batch cell failures)', () => {
    const s = setup()
    const failures = new CellFailures()
    const out: string[] = []
    runCells(
      Uint32Array.of(0, 1, 2),
      (row) => {
        if (row === 1) throw foreign()
        return 'ok'
      },
      out,
      '',
      failures,
    )
    failures.report(s.hub.emit, 2, 'email', 'format')
    expectClean(s, 'DK_CALLBACK_FAILED')
  })

  it('DK_INTERNAL (throw traced to DataKable code), including the issue link', () => {
    const s = setup()
    s.rt.run('pipeline:step', createContext('pipeline:step', {} as never, 'core', s.base), () => {
      throw own()
    })
    expectClean(s, 'DK_INTERNAL')
    const d = s.seen[0] as Diagnostic
    if (dev) {
      expect(d.fix.join('\n')).toContain('issues/new')
      expect(d.problem).toContain(`message: string(${message.length})`)
    }
  })

  it('DK_UNKNOWN (unclassifiable throw)', () => {
    const s = setup()
    s.rt.run('pipeline:step', createContext('pipeline:step', {} as never, 'core', s.base), () => {
      throw foreign()
    })
    expectClean(s, 'DK_UNKNOWN')
  })
})

it("DK_INTERNAL keeps the raw error message under 'full'", () => {
  const seen: Diagnostic[] = []
  const hub = createDiagnostics({
    dev: true,
    console: false,
    redaction: 'full',
    onDiagnostic: (d) => seen.push(d),
  })
  const rt = createInterceptorRuntime({ emit: hub.emit, interceptors: [] })
  hub.attach(rt)
  rt.installBoundary(errorBoundary)
  const base: ContextBase = {
    table: undefined,
    run: 1,
    trigger: 'init',
    phase: 'client',
    emit: hub.emit,
  }
  rt.run('pipeline:step', createContext('pipeline:step', {} as never, 'core', base), () => {
    throw own()
  })
  expect(seen[0]?.code).toBe('DK_INTERNAL')
  expect(seen[0]?.problem).toContain(SENTINEL)
})
