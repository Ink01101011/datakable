import { describe, expect, it, vi } from 'vitest'
import { type ContextBase, createContext } from './context'
import { defineInterceptor, type Interceptor } from './define'
import type { OpName } from './operations'
import { createInterceptorRuntime } from './runtime'

const base: ContextBase = {
  table: undefined,
  run: 1,
  trigger: 'init',
  phase: 'client',
  emit: () => {},
}
const stepCtx = () =>
  createContext(
    'pipeline:step',
    { stage: 'sort', feature: 'sorting', indices: new Uint32Array([2, 1]) },
    'features.sorting',
    base,
  )
const coreStep = () => new Uint32Array([1, 2])

const tag = (name: string, log: string[]) =>
  defineInterceptor({
    name,
    on: ['pipeline:step'],
    intercept(_ctx, next) {
      log.push(`${name}>`)
      const r = next()
      log.push(`<${name}`)
      return r
    },
  })

describe('createInterceptorRuntime', () => {
  it('runs the core directly when nothing is attached', () => {
    const rt = createInterceptorRuntime()
    expect(rt.run('pipeline:step', stepCtx(), coreStep)).toEqual(new Uint32Array([1, 2]))
  })

  it('first listed interceptor is outermost', () => {
    const log: string[] = []
    const rt = createInterceptorRuntime({ interceptors: [tag('a', log), tag('b', log)] })
    rt.run('pipeline:step', stepCtx(), () => {
      log.push('core')
      return coreStep()
    })
    expect(log).toEqual(['a>', 'b>', 'core', '<b', '<a'])
  })

  it('only attaches an interceptor to the ops it lists; "*" attaches everywhere', () => {
    const log: string[] = []
    const all = defineInterceptor({
      name: 'all',
      on: '*',
      intercept(ctx, next) {
        log.push(`all:${ctx.op}`)
        return next()
      },
    })
    const rt = createInterceptorRuntime({ interceptors: [tag('step', log), all] })
    rt.run(
      'state:dispatch',
      createContext('state:dispatch', { updater: 1 }, 'setState', base),
      () => {
        log.push('core')
      },
    )
    expect(log).toEqual(['all:state:dispatch', 'core'])
  })

  it('interceptor can replace the result', () => {
    const rt = createInterceptorRuntime({
      interceptors: [
        defineInterceptor({
          name: 'rev',
          on: ['pipeline:step'],
          intercept: (_c, next) => next().slice().reverse(),
        }),
      ],
    })
    expect(rt.run('pipeline:step', stepCtx(), coreStep)).toEqual(new Uint32Array([2, 1]))
  })

  describe('compile once', () => {
    it('compiles every registered op exactly once at init, then never again while running', () => {
      const onCompile = vi.fn()
      const rt = createInterceptorRuntime({ interceptors: [tag('a', [])], onCompile })
      const ops = onCompile.mock.calls.map((c) => c[0])
      expect(new Set(ops).size).toBe(ops.length)
      expect(ops).toEqual(expect.arrayContaining(['pipeline:step', 'pipeline:run', 'column:batch']))
      expect(onCompile).toHaveBeenCalledWith('pipeline:step', 1)
      expect(onCompile).toHaveBeenCalledWith('pipeline:run', 0)
      onCompile.mockClear()
      for (let i = 0; i < 5; i++) rt.run('pipeline:step', stepCtx(), coreStep)
      rt.run('pipeline:run', createContext('pipeline:run', { rowCount: 2 }, 'run', base), () =>
        coreStep(),
      )
      expect(onCompile).not.toHaveBeenCalled()
    })

    it('recompiles when the interceptor list changes, and only then', () => {
      const onCompile = vi.fn()
      const log: string[] = []
      const rt = createInterceptorRuntime({ onCompile })
      rt.run('pipeline:step', stepCtx(), coreStep)
      onCompile.mockClear()
      rt.setInterceptors([tag('late', log)])
      const compiledAfterChange = onCompile.mock.calls.length
      expect(compiledAfterChange).toBeGreaterThan(0)
      for (let i = 0; i < 3; i++) rt.run('pipeline:step', stepCtx(), coreStep)
      expect(onCompile).toHaveBeenCalledTimes(compiledAfterChange)
      expect(log).toEqual(['late>', '<late', 'late>', '<late', 'late>', '<late'])
    })
  })

  describe('a throwing interceptor is skipped and reported', () => {
    it('throw before next → next is called directly', () => {
      const onInterceptorError = vi.fn()
      const err = new Error('boom')
      const bad = defineInterceptor({
        name: 'bad',
        on: ['pipeline:step'],
        intercept() {
          throw err
        },
      })
      const core = vi.fn(coreStep)
      const rt = createInterceptorRuntime({ interceptors: [bad], onInterceptorError })
      const ctx = stepCtx()
      expect(rt.run('pipeline:step', ctx, core)).toEqual(new Uint32Array([1, 2]))
      expect(core).toHaveBeenCalledTimes(1)
      expect(onInterceptorError).toHaveBeenCalledWith(err, bad, ctx)
    })

    it('throw after next → the result of next is kept, the core does not run twice', () => {
      const onInterceptorError = vi.fn()
      const bad = defineInterceptor({
        name: 'late-bad',
        on: ['pipeline:step'],
        intercept(_c, next) {
          next()
          throw new Error('after')
        },
      })
      const core = vi.fn(coreStep)
      const rt = createInterceptorRuntime({ interceptors: [bad], onInterceptorError })
      expect(rt.run('pipeline:step', stepCtx(), core)).toEqual(new Uint32Array([1, 2]))
      expect(core).toHaveBeenCalledTimes(1)
      expect(onInterceptorError).toHaveBeenCalledTimes(1)
    })

    it('an error out of next (the core) is rethrown and not blamed on the interceptor', () => {
      const onInterceptorError = vi.fn()
      const coreErr = new Error('core')
      const rt = createInterceptorRuntime({ interceptors: [tag('a', [])], onInterceptorError })
      expect(() =>
        rt.run('pipeline:step', stepCtx(), () => {
          throw coreErr
        }),
      ).toThrow(coreErr)
      expect(onInterceptorError).not.toHaveBeenCalled()
    })

    it('async op: a rejection before next → next is called directly', async () => {
      const onInterceptorError = vi.fn()
      const bad = defineInterceptor({
        name: 'async-bad',
        on: ['async:request'],
        async intercept() {
          throw new Error('nope')
        },
      })
      const rt = createInterceptorRuntime({ interceptors: [bad], onInterceptorError })
      const ctx = createContext('async:request', { source: 'fetcher' }, 'fetcher', base)
      await expect(rt.run('async:request', ctx, async () => 'data')).resolves.toBe('data')
      expect(onInterceptorError).toHaveBeenCalledTimes(1)
    })

    it('async op: a rejection after next resolved → that result is kept', async () => {
      const onInterceptorError = vi.fn()
      const core = vi.fn(async () => 'data')
      const bad = defineInterceptor({
        name: 'async-late',
        on: ['async:request'],
        async intercept(_c, next) {
          await next()
          throw new Error('after')
        },
      })
      const rt = createInterceptorRuntime({ interceptors: [bad], onInterceptorError })
      const ctx = createContext('async:request', { source: 'fetcher' }, 'fetcher', base)
      await expect(rt.run('async:request', ctx, core)).resolves.toBe('data')
      expect(core).toHaveBeenCalledTimes(1)
      expect(onInterceptorError).toHaveBeenCalledTimes(1)
    })

    it('async op: a rejection from the core propagates and is not blamed', async () => {
      const onInterceptorError = vi.fn()
      const pass = defineInterceptor({
        name: 'pass',
        on: ['async:request'],
        intercept: (_c, next) => next(),
      })
      const rt = createInterceptorRuntime({ interceptors: [pass], onInterceptorError })
      const ctx = createContext('async:request', { source: 'fetcher' }, 'fetcher', base)
      await expect(
        rt.run('async:request', ctx, () => Promise.reject(new Error('net'))),
      ).rejects.toThrow('net')
      expect(onInterceptorError).not.toHaveBeenCalled()
    })
  })

  describe('boundary slot', () => {
    const boundary = (log: string[]): Interceptor<OpName> =>
      defineInterceptor({
        name: 'errorBoundary',
        on: '*',
        hot: true,
        intercept(_c, next) {
          log.push('boundary>')
          return next()
        },
      })

    it('is outermost and survives setInterceptors', () => {
      const log: string[] = []
      const rt = createInterceptorRuntime({ interceptors: [tag('a', log)] })
      rt.installBoundary(boundary(log))
      rt.run('pipeline:step', stepCtx(), coreStep)
      expect(log).toEqual(['boundary>', 'a>', '<a'])
      log.length = 0
      rt.setInterceptors([])
      rt.run('pipeline:step', stepCtx(), coreStep)
      expect(log).toEqual(['boundary>'])
    })

    it('cannot be installed twice', () => {
      const rt = createInterceptorRuntime()
      rt.installBoundary(boundary([]))
      expect(() => rt.installBoundary(boundary([]))).toThrow(/already installed/)
    })
  })

  describe('hot ops', () => {
    const onBatch = (hot?: boolean) =>
      defineInterceptor({
        name: 'perf',
        on: ['column:batch'],
        ...(hot === undefined ? {} : { hot }),
        intercept: (_c, next) => next(),
      })

    it('warns, stating the cost, when attached without hot: true', () => {
      const onHotWarning = vi.fn()
      const i = onBatch()
      createInterceptorRuntime({ interceptors: [i], onHotWarning })
      expect(onHotWarning).toHaveBeenCalledTimes(1)
      const w = onHotWarning.mock.calls[0]?.[0]
      expect(w.op).toBe('column:batch')
      expect(w.interceptor).toBe(i)
      expect(w.message).toMatch(/hot: true/)
      expect(w.message).toMatch(/per column per pipeline run/)
      expect(w.message).toMatch(/%/)
    })

    it('does not warn with hot: true, and "*" without it warns for the hot op only', () => {
      const onHotWarning = vi.fn()
      createInterceptorRuntime({ interceptors: [onBatch(true)], onHotWarning })
      expect(onHotWarning).not.toHaveBeenCalled()
      createInterceptorRuntime({
        interceptors: [defineInterceptor({ name: 'all', on: '*', intercept: (_c, n) => n() })],
        onHotWarning,
      })
      expect(onHotWarning.mock.calls.map((c) => c[0].op)).toEqual(['column:batch'])
    })

    it('default warning goes to console.warn', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      createInterceptorRuntime({ interceptors: [onBatch()] })
      expect(warn).toHaveBeenCalledTimes(1)
      warn.mockRestore()
    })
  })

  it('throws on an op that is not registered at runtime', () => {
    const rt = createInterceptorRuntime()
    // @ts-expect-error not a registered op
    expect(() => rt.run('nope:op', stepCtx(), coreStep)).toThrow(/unknown operation/i)
  })
})
