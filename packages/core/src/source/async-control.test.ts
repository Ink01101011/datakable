import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildDiagnostic, formatWhere } from '../diagnostics/build'
import { getDiagnosticDefinition } from '../diagnostics/catalog'
import { createDiagnostics, type DiagnosticsOptions } from '../diagnostics/hub'
import type { Diagnostic } from '../diagnostics/types'
import { errorBoundary } from '../intercept/boundary'
import { callUser } from '../intercept/classify'
import { type ContextBase, createContext } from '../intercept/context'
import { defineInterceptor, type Interceptor } from '../intercept/define'
import { FALLBACK } from '../intercept/fallbacks'
import type { OpInput, OpName } from '../intercept/operations'
import { createInterceptorRuntime } from '../intercept/runtime'
import {
  ASYNC_STATUS,
  type AsyncStatus,
  asyncControl,
  DEFAULT_ASYNC_TIMEOUT,
} from './async-control'
import { asyncDiagnostics } from './codes'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

type Source = OpInput<'async:request'>['source']

/** A table-like setup: hub + runtime + boundary + asyncControl (first in the list, as T07 installs it). */
function setup(
  o: DiagnosticsOptions & { timeout?: number; interceptors?: Interceptor<OpName>[] } = {},
) {
  const seen: Diagnostic[] = []
  const hub = createDiagnostics({ console: false, onDiagnostic: (d) => seen.push(d), ...o })
  const control = asyncControl(o.timeout === undefined ? {} : { timeout: o.timeout })
  const rt = createInterceptorRuntime({
    emit: hub.emit,
    interceptors: [control as Interceptor<OpName>, ...(o.interceptors ?? [])],
  })
  hub.attach(rt)
  rt.installBoundary(errorBoundary)
  const base: ContextBase = {
    table: undefined,
    run: 3,
    trigger: 'fetch',
    phase: 'client',
    emit: hub.emit,
  }

  /** Starts one request the way a source (T17 / T21) does: previous results as FALLBACK. */
  function request<R>(
    source: Source,
    core: (signal: AbortSignal) => Promise<R>,
    opts: { previous?: unknown; signal?: AbortSignal; where?: string; params?: unknown } = {},
  ) {
    const ctx = createContext(
      'async:request',
      opts.params === undefined ? { source } : { source, params: opts.params },
      opts.where ?? source,
      base,
      opts.signal,
    )
    ctx.meta.set(FALLBACK, opts.previous)
    const result = rt.run('async:request', ctx, (c) => core(c.signal as AbortSignal))
    return {
      ctx,
      result,
      settled: result.then((value) => ({
        value,
        status: ctx.meta.get(ASYNC_STATUS) as AsyncStatus,
      })),
    }
  }

  const destroy = () =>
    rt.run(
      'table:destroy',
      createContext('table:destroy', undefined, 'destroy', base),
      () => undefined,
    )

  return { hub, rt, seen, request, destroy, base }
}

/** A promise the test resolves / rejects by hand, ignoring any signal (a careless callback). */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Node's process events, typed locally (core does not depend on @types/node). */
type Listener = (...args: unknown[]) => void
const nodeProcess = (
  globalThis as unknown as {
    process: { on(e: string, f: Listener): void; off(e: string, f: Listener): void }
  }
).process

const abortError = () => new DOMException('The operation was aborted.', 'AbortError')

describe('asyncControl', () => {
  it('is a cold interceptor on async:request and table:destroy', () => {
    const c = asyncControl()
    expect(c.name).toBe('asyncControl')
    expect(c.on).toEqual(['async:request', 'table:destroy'])
    expect(c.hot).toBeFalsy()
    expect(DEFAULT_ASYNC_TIMEOUT).toBe(30_000)
  })

  it('applies a result and passes a fresh AbortSignal to the core', async () => {
    const s = setup()
    let got: AbortSignal | undefined
    const r = s.request('fetcher', async (signal) => {
      got = signal
      return { rows: [1], rowCount: 1 }
    })
    await expect(r.settled).resolves.toEqual({
      value: { rows: [1], rowCount: 1 },
      status: 'applied',
    })
    expect(got).toBeInstanceOf(AbortSignal)
    expect(got?.aborted).toBe(false)
    expect(r.ctx.signal).toBe(got)
    expect(s.seen).toEqual([])
  })

  it('latest wins: a superseded result is never applied even if the callback ignores the signal', async () => {
    const s = setup()
    const first = deferred<string>()
    const second = deferred<string>()
    let firstSignal: AbortSignal | undefined
    const a = s.request(
      'fetcher',
      (signal) => {
        firstSignal = signal
        return first.promise
      },
      { previous: 'old' },
    )
    const b = s.request('fetcher', () => second.promise, { previous: 'old' })

    // The first request settles as superseded at once, with the previous results.
    await expect(a.settled).resolves.toEqual({ value: 'old', status: 'superseded' })
    expect(firstSignal?.aborted).toBe(true)
    expect((firstSignal?.reason as DOMException | undefined)?.name).toBe('AbortError')

    // The careless callback resolves late — after the newer one was applied.
    second.resolve('new')
    await expect(b.settled).resolves.toEqual({ value: 'new', status: 'applied' })
    first.resolve('stale')
    await new Promise((r) => setTimeout(r, 0))
    expect(a.ctx.meta.get(ASYNC_STATUS)).toBe('superseded')
    await expect(a.result).resolves.toBe('old')
    expect(s.seen).toEqual([])
  })

  it('a caller that applies only on "applied" never shows a superseded result, in any order', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 6 }),
        fc.array(fc.nat(), { minLength: 6, maxLength: 6 }),
        async (n, order) => {
          const s = setup()
          let shown = 'initial'
          const calls = Array.from({ length: n }, (_, i) => {
            const d = deferred<string>()
            const r = s.request('searchFn', () => d.promise, { previous: shown })
            const applied = r.settled.then(({ value, status }) => {
              if (status === 'applied') shown = value as string
            })
            return { d, applied, i }
          })
          // Resolve in an arbitrary order; every callback ignores its signal.
          const idx = calls.map((c) => c.i).sort((x, y) => (order[x] ?? 0) - (order[y] ?? 0))
          for (const i of idx) calls[i]?.d.resolve(`r${i}`)
          await Promise.all(calls.map((c) => c.applied))
          expect(shown).toBe(`r${n - 1}`)
        },
      ),
      { numRuns: 50 },
    )
  })

  it('a superseded request that rejects later causes no diagnostic and no unhandled rejection', async () => {
    const s = setup()
    const unhandled = vi.fn()
    nodeProcess.on('unhandledRejection', unhandled)
    try {
      const first = deferred<string>()
      const a = s.request('fetcher', () => first.promise, { previous: 'old' })
      const b = s.request('fetcher', async () => 'new', { previous: 'old' })
      await expect(b.settled).resolves.toEqual({ value: 'new', status: 'applied' })
      first.reject(new Error('late failure'))
      await expect(a.settled).resolves.toEqual({ value: 'old', status: 'superseded' })
      await new Promise((r) => setTimeout(r, 0))
      expect(a.ctx.meta.get(ASYNC_STATUS)).toBe('superseded')
      expect(unhandled).not.toHaveBeenCalled()
      expect(s.seen).toEqual([])
    } finally {
      nodeProcess.off('unhandledRejection', unhandled)
    }
  })

  it('sources are independent: a search does not supersede a fetch', async () => {
    const s = setup()
    const f = deferred<string>()
    const a = s.request('fetcher', () => f.promise)
    const b = s.request('searchFn', async () => 'hits')
    await expect(b.settled).resolves.toEqual({ value: 'hits', status: 'applied' })
    f.resolve('rows')
    await expect(a.settled).resolves.toEqual({ value: 'rows', status: 'applied' })
  })

  it('timeout: aborts, emits DK_ASYNC_TIMEOUT once and keeps the previous results', async () => {
    vi.useFakeTimers()
    const s = setup({ timeout: 500 })
    let signal: AbortSignal | undefined
    const never = deferred<string>()
    const r = s.request(
      'fetcher',
      (sig) => {
        signal = sig
        return never.promise
      },
      { previous: 'old' },
    )
    await vi.advanceTimersByTimeAsync(499)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(r.settled).resolves.toEqual({ value: 'old', status: 'timeout' })
    expect(signal?.aborted).toBe(true)
    expect((signal?.reason as DOMException | undefined)?.name).toBe('TimeoutError')
    expect(s.seen.map((d) => d.code)).toEqual(['DK_ASYNC_TIMEOUT'])
    const d = s.seen[0] as Diagnostic
    expect(d.level).toBe('error')
    expect(d.where).toEqual({ kind: 'option', path: 'fetcher' })
    expect(d.details).toMatchObject({ source: 'fetcher', timeout: 500 })
    expect(d.context.run).toBe(3)
    expect(d.context.trigger).toBe('fetch')
    expect(d.problem).toMatch(/fetcher/)
    expect(d.problem).toMatch(/500 ms/)
    expect(d.fix.join('\n')).toMatch(/timeout/)
    // A late answer after the timeout is dropped.
    never.resolve('late')
    await vi.advanceTimersByTimeAsync(1)
    expect(r.ctx.meta.get(ASYNC_STATUS)).toBe('timeout')
    expect(s.seen).toHaveLength(1)
  })

  it('default timeout is 30 s; a request that answers in time clears its timer', async () => {
    vi.useFakeTimers()
    const s = setup()
    const slow = s.request('searchFn', () => new Promise(() => {}), { previous: [] })
    const fast = s.request('fetcher', async () => 'ok')
    await expect(fast.settled).resolves.toEqual({ value: 'ok', status: 'applied' })
    await vi.advanceTimersByTimeAsync(29_999)
    expect(slow.ctx.meta.get(ASYNC_STATUS)).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    await expect(slow.settled).resolves.toEqual({ value: [], status: 'timeout' })
    expect(s.seen.map((d) => d.code)).toEqual(['DK_ASYNC_TIMEOUT'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('timeout: Infinity disables the timer', async () => {
    vi.useFakeTimers()
    const s = setup({ timeout: Number.POSITIVE_INFINITY })
    const d = deferred<string>()
    const r = s.request('fetcher', () => d.promise)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    d.resolve('late but fine')
    await expect(r.settled).resolves.toEqual({ value: 'late but fine', status: 'applied' })
  })

  it("the caller's signal aborts the request (cancelSearch) without a diagnostic", async () => {
    const s = setup()
    const outer = new AbortController()
    let inner: AbortSignal | undefined
    const r = s.request(
      'searchFn',
      (sig) => {
        inner = sig
        return new Promise(() => {})
      },
      { previous: 'old', signal: outer.signal },
    )
    expect(inner).not.toBe(outer.signal)
    outer.abort()
    await expect(r.settled).resolves.toEqual({ value: 'old', status: 'aborted' })
    expect(inner?.aborted).toBe(true)
    expect(s.seen).toEqual([])
  })

  it('an already-aborted caller signal never runs the core', async () => {
    const s = setup()
    const outer = new AbortController()
    outer.abort()
    const core = vi.fn(async () => 'x')
    const r = s.request('fetcher', core, { previous: 'old', signal: outer.signal })
    await expect(r.settled).resolves.toEqual({ value: 'old', status: 'aborted' })
    expect(core).not.toHaveBeenCalled()
  })

  it('an AbortError rejection is "aborted", not an error', async () => {
    const s = setup()
    const r = s.request(
      'fetcher',
      async () => {
        throw abortError()
      },
      { previous: 'old' },
    )
    await expect(r.settled).resolves.toEqual({ value: 'old', status: 'aborted' })
    expect(s.seen).toEqual([])
  })

  it('a failing callback is "error": the boundary reports it and keeps the previous results', async () => {
    const s = setup()
    const boom = new TypeError('network down')
    const r = s.request(
      'fetcher',
      (sig) =>
        Promise.resolve().then(() =>
          callUser(
            'fetcher',
            () => {
              throw boom
            },
            sig,
          ),
        ),
      { previous: 'old' },
    )
    await expect(r.settled).resolves.toEqual({ value: 'old', status: 'error' })
    expect(s.seen.map((d) => d.code)).toEqual(['DK_CALLBACK_FAILED'])
    expect(s.seen[0]?.context.cause).toBe(boom)
  })

  it('a core that throws synchronously is "error" and frees the source slot', async () => {
    const s = setup()
    const r = s.request(
      'fetcher',
      () =>
        callUser(
          'fetcher',
          () => {
            throw new Error('sync')
          },
          undefined,
        ),
      { previous: 'old' },
    )
    await expect(r.settled).resolves.toEqual({ value: 'old', status: 'error' })
    const next = s.request('fetcher', async () => 'ok')
    await expect(next.settled).resolves.toEqual({ value: 'ok', status: 'applied' })
  })

  it('table:destroy aborts every in-flight request', async () => {
    const s = setup()
    const signals: AbortSignal[] = []
    const hang = (sig: AbortSignal) => {
      signals.push(sig)
      return new Promise<never>(() => {})
    }
    const a = s.request('fetcher', hang, {
      previous: 1,
    })
    const b = s.request('searchFn', hang, {
      previous: 2,
    })
    s.destroy()
    await expect(a.settled).resolves.toEqual({ value: 1, status: 'aborted' })
    await expect(b.settled).resolves.toEqual({ value: 2, status: 'aborted' })
    expect(signals.every((sig) => sig.aborted)).toBe(true)
    expect(s.seen).toEqual([])
  })

  it('inner interceptors see the controlled signal', async () => {
    const seenSignals: (AbortSignal | undefined)[] = []
    const s = setup({
      interceptors: [
        defineInterceptor({
          name: 'spy',
          on: ['async:request'],
          intercept(ctx, next) {
            seenSignals.push(ctx.signal)
            return next()
          },
        }),
      ],
    })
    let coreSignal: AbortSignal | undefined
    const r = s.request('fetcher', async (sig) => {
      coreSignal = sig
      return 1
    })
    await r.settled
    expect(seenSignals).toEqual([coreSignal])
  })

  it('separate tables do not supersede each other', async () => {
    const t1 = setup()
    const t2 = setup()
    const d = deferred<string>()
    const a = t1.request('fetcher', () => d.promise)
    const b = t2.request('fetcher', async () => 'two')
    await expect(b.settled).resolves.toEqual({ value: 'two', status: 'applied' })
    d.resolve('one')
    await expect(a.settled).resolves.toEqual({ value: 'one', status: 'applied' })
  })
})

describe('ctx.where never carries row data (R2 carry-over)', () => {
  const SENTINEL = 'alice@example.com'

  function exposed(d: Diagnostic): string {
    const { cause: _c, ...context } = d.context
    return [
      JSON.stringify(d),
      JSON.stringify(context),
      JSON.stringify(d.details),
      formatWhere(d.where),
      d.problem,
      d.impact,
      d.fix.join('\n'),
      decodeURIComponent(d.fix.join('\n')),
      d.docs,
      decodeURIComponent(d.docs),
      d.fingerprint,
    ].join('\n')
  }

  it('asyncControl never writes ctx.where, and its where is an option path from the source only', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<Source>('fetcher', 'searchFn'),
        fc.string(),
        fc.boolean(),
        fc.constantFrom('resolve', 'reject', 'timeout', 'supersede'),
        async (source, junk, dev, outcome) => {
          vi.useFakeTimers()
          try {
            const value = `${SENTINEL}${junk}`
            const s = setup({ dev, redaction: 'safe', timeout: 100 })
            const wheres: string[] = []
            const spy = defineInterceptor({
              name: 'where-spy',
              on: ['async:request'],
              intercept(ctx, next) {
                wheres.push(ctx.where)
                return next()
              },
            })
            s.rt.setInterceptors([asyncControl({ timeout: 100 }) as Interceptor<OpName>, spy])
            const core = async () => {
              if (outcome === 'reject') {
                throw callUser(
                  'fetcher',
                  () => {
                    throw new TypeError(`bad '${value}'`)
                  },
                  undefined,
                )
              }
              if (outcome === 'resolve') return { rows: [{ email: value }] }
              return new Promise(() => {})
            }
            const r = s.request(source, core, {
              previous: [{ email: value }],
              params: { query: value, filters: { email: value } },
            })
            if (outcome === 'supersede') s.request(source, async () => [])
            await vi.advanceTimersByTimeAsync(200)
            await r.settled
            expect(r.ctx.where).toBe(source)
            expect(wheres.every((w) => w === source)).toBe(true)
            for (const d of s.seen) {
              expect(exposed(d)).not.toContain('alice')
              if (d.code === 'DK_ASYNC_TIMEOUT') {
                expect(d.where).toEqual({ kind: 'option', path: source })
              }
            }
          } finally {
            vi.useRealTimers()
          }
        },
      ),
      { numRuns: 60 },
    )
  })

  it('DK_ASYNC_TIMEOUT where ignores a ctx.where that (wrongly) holds data', async () => {
    vi.useFakeTimers()
    const s = setup({ redaction: 'safe', timeout: 10 })
    const r = s.request('searchFn', () => new Promise(() => {}), {
      where: `searchFn("${SENTINEL}")`,
    })
    await vi.advanceTimersByTimeAsync(10)
    await r.settled
    expect(s.seen.map((d) => d.code)).toEqual(['DK_ASYNC_TIMEOUT'])
    expect(exposed(s.seen[0] as Diagnostic)).not.toContain('alice')
  })
})

describe('DK_ASYNC_TIMEOUT catalog entry', () => {
  it('is defined with non-empty where, problem, impact and fix', () => {
    expect(asyncDiagnostics.map((d) => d.code)).toEqual(['DK_ASYNC_TIMEOUT'])
    const def = asyncDiagnostics[0]
    expect(getDiagnosticDefinition('DK_ASYNC_TIMEOUT')).toBe(def)
    const d = buildDiagnostic(
      'DK_ASYNC_TIMEOUT',
      { source: 'searchFn', timeout: 30_000 },
      { dev: true },
    )
    expect(d.level).toBe('error')
    expect(d.where).toEqual({ kind: 'option', path: 'searchFn' })
    expect(d.fingerprint).toBe('DK_ASYNC_TIMEOUT@options.searchFn')
    expect(d.problem).toMatch(/30000 ms|30 s/)
    expect(d.impact).toMatch(/previous results/)
    expect(d.fix.length).toBeGreaterThan(1)
    expect(d.fix.join('\n')).toMatch(/signal/)
  })
})
