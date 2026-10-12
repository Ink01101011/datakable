import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from '../diagnostics/types'
import { defineInterceptor } from '../intercept/define'
import { createTable } from './create-table'
import { getTableInternals } from './internals'

// R3 integration: one asyncControl per table, first in the interceptor list, aborted by destroy().

let seen: Diagnostic[]
const onDiagnostic = (d: Diagnostic) => {
  seen.push(d)
}

beforeEach(() => {
  seen = []
  for (const m of ['error', 'warn', 'info', 'log', 'groupCollapsed', 'group', 'groupEnd'] as const)
    vi.spyOn(console, m).mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** A promise resolved by hand, ignoring any signal (a careless callback). */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

type S = { rows: string[] }

const make = (extra: Parameters<typeof createTable<unknown, S>>[0] = {}) =>
  createTable<unknown, S>({ initialState: { rows: ['old'] }, onDiagnostic, ...extra })

describe('createTable: asyncControl integration', () => {
  it('destroy() aborts an in-flight request; its late result is never applied', async () => {
    const t = make()
    const late = deferred<string[]>()
    let signal: AbortSignal | undefined
    const req = getTableInternals(t).request(
      'fetcher',
      (s) => {
        signal = s
        return late.promise
      },
      { previous: t.getState().rows },
    )
    t.destroy()
    expect(signal?.aborted).toBe(true)
    const out = await req
    expect(out).toEqual({ value: ['old'], status: 'aborted' })
    late.resolve(['stale'])
    await Promise.resolve()
    expect(t.getState().rows).toEqual(['old'])
    expect(seen).toEqual([])
  })

  it("a superseded request's late result is never applied through a real table", async () => {
    const t = make()
    const { request } = getTableInternals(t)
    const apply = async (p: ReturnType<typeof request>) => {
      const { value, status } = await p
      if (status === 'applied') t.setState({ rows: value as string[] })
      return status
    }
    const first = deferred<string[]>()
    const second = deferred<string[]>()
    const a = apply(request('fetcher', () => first.promise, { previous: t.getState().rows }))
    const b = apply(request('fetcher', () => second.promise, { previous: t.getState().rows }))
    second.resolve(['new'])
    expect(await b).toBe('applied')
    first.resolve(['stale'])
    expect(await a).toBe('superseded')
    await Promise.resolve()
    expect(t.getState().rows).toEqual(['new'])
  })

  it('options.timeout reaches asyncControl (DK_ASYNC_TIMEOUT, previous results kept)', async () => {
    vi.useFakeTimers()
    const t = make({ timeout: 50 })
    const never = deferred<string[]>()
    const req = getTableInternals(t).request('searchFn', () => never.promise, { previous: ['old'] })
    await vi.advanceTimersByTimeAsync(50)
    expect(await req).toEqual({ value: ['old'], status: 'timeout' })
    expect(seen.map((d) => d.code)).toEqual(['DK_ASYNC_TIMEOUT'])
  })

  it('asyncControl stays first after setOptions({ interceptors }): inner ones see its signal', async () => {
    const signals: (AbortSignal | undefined)[] = []
    const spy = defineInterceptor({
      name: 'spy',
      on: ['async:request'],
      intercept: (ctx, next) => {
        signals.push(ctx.signal)
        return next()
      },
    })
    const t = make()
    t.setOptions({ interceptors: [spy] })
    let core: AbortSignal | undefined
    await getTableInternals(t).request('fetcher', async (s) => {
      core = s
      return []
    })
    expect(signals).toHaveLength(1)
    expect(signals[0]).toBe(core)
    expect(core).toBeInstanceOf(AbortSignal)
  })
})
