import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatakableError } from '../../diagnostics/build'
import type { Diagnostic } from '../../diagnostics/types'
import { minFilter } from '../../pipeline/test-features'
import { createTable } from '../../table/create-table'
import { type SearchFnContext, type SearchOptions, type SearchTyping, search } from './search'

let seen: Diagnostic[]
const onDiagnostic = (d: Diagnostic) => {
  seen.push(d)
}
const codes = () => seen.map((d) => d.code)
const unhandled: unknown[] = []
type Proc = {
  on(e: string, f: (e: unknown) => void): void
  off(e: string, f: (e: unknown) => void): void
}
const proc = (globalThis as unknown as { process: Proc }).process
const onUnhandled = (e: unknown) => {
  unhandled.push(e)
}

beforeEach(() => {
  seen = []
  unhandled.length = 0
  proc.on('unhandledRejection', onUnhandled)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
  vi.useRealTimers()
  await new Promise((r) => setTimeout(r, 0))
  proc.off('unhandledRejection', onUnhandled)
  expect(unhandled).toEqual([])
  vi.restoreAllMocks()
})

type U = { id: number; name: string; age: number }
const users: U[] = [
  { id: 0, name: 'Adams', age: 31 },
  { id: 1, name: 'Ada', age: 25 },
  { id: 2, name: 'Bob', age: 40 },
  { id: 3, name: 'Cara', age: 19 },
]
const tick = () => new Promise((r) => setTimeout(r, 0))

/** A searchFn whose calls the test settles by hand. */
function manual() {
  const calls: {
    ctx: SearchFnContext<U>
    resolve: (r: unknown) => void
    reject: (e: unknown) => void
  }[] = []
  const searchFn = vi.fn(
    (ctx: SearchFnContext<U>) =>
      new Promise<readonly U[]>((resolve, reject) => {
        calls.push({ ctx, resolve: resolve as (r: unknown) => void, reject })
      }),
  )
  const last = () => calls[calls.length - 1] as (typeof calls)[number]
  return { searchFn, calls, last }
}

const make = (
  searchFn: NonNullable<SearchOptions<U>['searchFn']>,
  typing?: SearchTyping,
  extra: { data?: readonly U[]; strict?: boolean; timeout?: number } = {},
) =>
  createTable({
    data: extra.data ?? users,
    onDiagnostic,
    rowKey: 'id',
    columns: [{ key: 'name', search: 1 }, { key: 'age' }],
    features: [search<U>({ searchFn, ...(typing ? { typing } : {}) })],
    ...(extra.strict === undefined ? {} : { strict: extra.strict }),
    ...(extra.timeout === undefined ? {} : { timeout: extra.timeout }),
  })
type T = ReturnType<typeof make>
const ids = (t: T) => t.getRowModel().rows.map((r) => r.original.id)
const slice = (t: T) => t.getState().search

describe('setSearch / flushSearch outcomes without searchFn (R7: resolve when applied)', () => {
  const plain = (typing: SearchTyping) =>
    createTable({
      data: users,
      onDiagnostic,
      columns: [{ key: 'name', search: 1 }],
      features: [search({ typing })],
    })

  it('debounce: resolves only once the query is applied, not while pending', async () => {
    vi.useFakeTimers()
    const t = plain({ strategy: 'debounce', wait: 100 })
    let outcome: unknown
    void t.setSearch('bob').then((o) => {
      outcome = o
    })
    await vi.advanceTimersByTimeAsync(50)
    expect(t.getState().search.status).toBe('pending')
    expect(outcome).toBeUndefined()
    await vi.advanceTimersByTimeAsync(60)
    expect(outcome).toEqual({ status: 'applied' })
    expect(t.getState().search.query).toBe('bob')
  })

  it("a later keystroke replaces a pending one: 'superseded', the last one 'applied'", async () => {
    vi.useFakeTimers()
    const t = plain({ strategy: 'debounce', wait: 100 })
    const a = t.setSearch('bo')
    const b = t.setSearch('bob')
    await vi.advanceTimersByTimeAsync(100)
    await expect(a).resolves.toEqual({ status: 'superseded' })
    await expect(b).resolves.toEqual({ status: 'applied' })
  })

  it("cancelSearch() resolves the pending query 'superseded'; flushSearch() applies at once", async () => {
    vi.useFakeTimers()
    const t = plain({ strategy: 'debounce', wait: 100 })
    const a = t.setSearch('bob')
    t.cancelSearch()
    await expect(a).resolves.toEqual({ status: 'superseded' })
    const b = t.setSearch('cara')
    const f = t.flushSearch()
    await expect(b).resolves.toEqual({ status: 'applied' })
    await expect(f).resolves.toEqual({ status: 'applied' })
    expect(t.getState().search.query).toBe('cara')
  })

  it("commitOn 'enter': setSearch resolves when flushSearch() commits it", async () => {
    const t = plain({ commitOn: 'enter' })
    let outcome: unknown
    void t.setSearch('bob').then((o) => {
      outcome = o
    })
    await tick()
    expect(outcome).toBeUndefined()
    await t.flushSearch()
    expect(outcome).toEqual({ status: 'applied' })
  })

  it("throttle: the first keystroke applies at once, the middle one is 'superseded'", async () => {
    vi.useFakeTimers()
    const t = plain({ strategy: 'throttle', wait: 100 })
    const a = t.setSearch('b')
    const b = t.setSearch('bo')
    const c = t.setSearch('bob')
    await expect(a).resolves.toEqual({ status: 'applied' })
    await vi.advanceTimersByTimeAsync(100)
    await expect(b).resolves.toEqual({ status: 'superseded' })
    await expect(c).resolves.toEqual({ status: 'applied' })
  })

  it("destroy() resolves a pending query 'superseded' (never left hanging)", async () => {
    vi.useFakeTimers()
    const t = plain({ strategy: 'debounce', wait: 100 })
    const a = t.setSearch('bob')
    t.destroy()
    await expect(a).resolves.toEqual({ status: 'superseded' })
  })

  it("after destroy(), setSearch / flushSearch still return a promise: 'superseded'", async () => {
    const t = plain({ strategy: 'debounce', wait: 100 })
    t.destroy()
    const a = t.setSearch('bob')
    const b = t.flushSearch()
    expect(typeof a?.then).toBe('function')
    await expect(a).resolves.toEqual({ status: 'superseded' })
    await expect(b).resolves.toEqual({ status: 'superseded' })
    expect(t.clearSearch()).toBeUndefined()
    expect(codes().filter((c) => c === 'DK_TABLE_DESTROYED')).toHaveLength(3)
  })
})

describe('async searchFn (§6.3)', () => {
  it("'searching' keeps the previous results; the result is applied in its order", async () => {
    const m = manual()
    const t = make(m.searchFn)
    const statuses: [string, string][] = []
    t.subscribe(() => statuses.push([t.getRowModel().status, t.getState().search.status]))
    const p = t.setSearch('a')
    expect(slice(t)).toEqual({ input: 'a', query: '', status: 'searching' })
    expect(t.getRowModel().status).toBe('searching')
    expect(ids(t)).toEqual([0, 1, 2, 3])
    expect(m.last().ctx.query).toBe('a')
    expect(m.last().ctx.rows).toBe(t.getData())
    expect(m.last().ctx.signal).toBeInstanceOf(AbortSignal)
    m.last().resolve([users[3], users[0]])
    await expect(p).resolves.toEqual({ status: 'applied' })
    expect(slice(t)).toEqual({ input: 'a', query: 'a', status: 'idle' })
    expect(ids(t)).toEqual([3, 0])
    expect(t.getRowModel().status).toBe('idle')
    // One notification at start, one when applied (status + rows together).
    expect(statuses).toEqual([
      ['searching', 'searching'],
      ['idle', 'idle'],
    ])
  })

  it('accepts { keys } (row keys) and a synchronous result', async () => {
    const t = make(({ query }) => (query === 'x' ? { keys: [2, 1] } : [users[3] as U]))
    await expect(t.setSearch('x')).resolves.toEqual({ status: 'applied' })
    expect(ids(t)).toEqual([2, 1])
    await expect(t.setSearch('y')).resolves.toEqual({ status: 'applied' })
    expect(ids(t)).toEqual([3])
  })

  it('the result is intersected with the filtered rows (search runs after filters)', async () => {
    const t = createTable({
      data: users,
      columns: [{ key: 'name' }, { key: 'age' }],
      features: [search<U>({ searchFn: () => users }), minFilter('age')],
      initialState: { minFilter: { min: 30 } },
    })
    const api = t as unknown as { setSearch(q: string): Promise<unknown> }
    await api.setSearch('q')
    const rows = t.getRowModel().rows as readonly { original: U }[]
    expect(rows.map((r) => r.original.id)).toEqual([0, 2])
  })

  it('a blank query shows every row without calling searchFn', async () => {
    const m = manual()
    const t = make(m.searchFn)
    const p = t.setSearch('a')
    m.last().resolve([users[1]])
    await p
    await expect(t.setSearch('   ')).resolves.toEqual({ status: 'applied' })
    expect(m.calls).toHaveLength(1)
    expect(ids(t)).toEqual([0, 1, 2, 3])
  })

  it("latest wins: the earlier request is 'superseded', aborted, and its late result ignored", async () => {
    const m = manual()
    const t = make(m.searchFn)
    const a = t.setSearch('a')
    const first = m.last()
    const b = t.setSearch('b')
    expect(first.ctx.signal.aborted).toBe(true)
    m.last().resolve([users[2]])
    first.resolve([users[0]])
    await expect(a).resolves.toEqual({ status: 'superseded' })
    await expect(b).resolves.toEqual({ status: 'applied' })
    await tick()
    expect(ids(t)).toEqual([2])
    expect(slice(t).query).toBe('b')
  })

  it('stale-while-error: DK_SEARCH_FAILED, previous results kept, outcome error, no rejection', async () => {
    const m = manual()
    const t = make(m.searchFn)
    const ok = t.setSearch('a')
    m.last().resolve([users[1]])
    await ok
    const failing = t.setSearch('b')
    const boom = new TypeError('down')
    m.last().reject(boom)
    await expect(failing).resolves.toEqual({ status: 'error' })
    expect(slice(t)).toEqual({ input: 'b', query: 'a', status: 'error', error: boom })
    expect(t.getRowModel().status).toBe('error')
    expect(ids(t)).toEqual([1])
    const d = seen.find((x) => x.code === 'DK_SEARCH_FAILED') as Diagnostic
    expect(d.level).toBe('error')
    expect(d.where).toEqual({ kind: 'option', path: 'searchFn' })
    expect(d.details).toMatchObject({ errorName: 'TypeError', hadResults: true })
    expect(d.fix.join(' ')).toMatch(/flushSearch/)
    expect(d.context.cause).toBe(boom)
    // Retry from the UI: flushSearch() runs the input again and recovers.
    const retry = t.flushSearch()
    expect(slice(t).status).toBe('searching')
    m.last().resolve([users[2]])
    await expect(retry).resolves.toEqual({ status: 'applied' })
    expect(slice(t)).toEqual({ input: 'b', query: 'b', status: 'idle' })
    expect(t.getRowModel().status).toBe('idle')
  })

  it('a synchronous throw is DK_SEARCH_FAILED too', async () => {
    const t = make(() => {
      throw new Error('sync')
    })
    await expect(t.setSearch('a')).resolves.toEqual({ status: 'error' })
    expect(codes()).toContain('DK_SEARCH_FAILED')
    expect(ids(t)).toEqual([0, 1, 2, 3])
  })

  it('a malformed result is DK_SEARCH_FAILED (bad-result) and ignored', async () => {
    const t = make(() => ({ nope: true }) as never)
    await expect(t.setSearch('a')).resolves.toEqual({ status: 'error' })
    const d = seen.find((x) => x.code === 'DK_SEARCH_FAILED') as Diagnostic
    expect(d.details).toMatchObject({ problem: 'bad-result', hadResults: false })
    expect(d.problem).toMatch(/rows|keys/)
  })

  it("an AbortError is not an error: no diagnostic, status back to 'idle', 'superseded'", async () => {
    const t = make(() => Promise.reject(new DOMException('stop', 'AbortError')))
    await expect(t.setSearch('a')).resolves.toEqual({ status: 'superseded' })
    expect(codes()).not.toContain('DK_SEARCH_FAILED')
    expect(slice(t).status).toBe('idle')
    expect(t.getRowModel().status).toBe('idle')
  })

  it('a timeout is an error outcome (DK_ASYNC_TIMEOUT, not DK_SEARCH_FAILED)', async () => {
    vi.useFakeTimers()
    const t = make(() => new Promise<never>(() => {}), undefined, { timeout: 50 })
    const p = t.setSearch('a')
    await vi.advanceTimersByTimeAsync(60)
    await expect(p).resolves.toEqual({ status: 'error' })
    expect(codes()).toContain('DK_ASYNC_TIMEOUT')
    expect(codes()).not.toContain('DK_SEARCH_FAILED')
    expect(slice(t).status).toBe('error')
  })

  it('strict: the error is reported, the promise still resolves (no rejection)', async () => {
    const t = make(() => Promise.reject(new Error('x')), undefined, { strict: true })
    await expect(t.setSearch('a')).resolves.toEqual({ status: 'error' })
    expect(slice(t).status).toBe('error')
    expect(seen.some((d) => d.code === 'DK_SEARCH_FAILED')).toBe(true)
    expect(DatakableError).toBeDefined()
  })

  it("typing back to the applied query cancels the in-flight search ('superseded')", async () => {
    const m = manual()
    const t = make(m.searchFn)
    const a = t.setSearch('a')
    m.last().resolve([users[0]])
    await a
    const b = t.setSearch('b')
    const back = t.setSearch('a')
    expect(m.calls[1]?.ctx.signal.aborted).toBe(true)
    await expect(b).resolves.toEqual({ status: 'superseded' })
    await expect(back).resolves.toEqual({ status: 'applied' })
    expect(slice(t)).toEqual({ input: 'a', query: 'a', status: 'idle' })
  })

  it("cancelSearch() / clearSearch() abort an in-flight search ('superseded')", async () => {
    const m = manual()
    const t = make(m.searchFn)
    const a = t.setSearch('a')
    t.cancelSearch()
    await expect(a).resolves.toEqual({ status: 'superseded' })
    expect(slice(t)).toEqual({ input: 'a', query: '', status: 'idle' })
    const b = t.setSearch('b')
    t.clearSearch()
    await expect(b).resolves.toEqual({ status: 'superseded' })
    expect(slice(t)).toEqual({ input: '', query: '', status: 'idle' })
    expect(t.getRowModel().status).toBe('idle')
  })

  it('debounce + searchFn: pending, then searching, then applied', async () => {
    vi.useFakeTimers()
    const m = manual()
    const t = make(m.searchFn, { strategy: 'debounce', wait: 100 })
    const p = t.setSearch('a')
    expect(slice(t).status).toBe('pending')
    expect(m.calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(100)
    expect(slice(t).status).toBe('searching')
    m.last().resolve([users[1]])
    await vi.advanceTimersByTimeAsync(0)
    await expect(p).resolves.toEqual({ status: 'applied' })
    expect(ids(t)).toEqual([1])
  })

  it('new data re-runs searchFn for the applied query; previous hits stay meanwhile', async () => {
    const m = manual()
    const t = make(m.searchFn)
    const p = t.setSearch('a')
    m.last().resolve([users[1], users[3]])
    await p
    const next = [...users, { id: 4, name: 'Dee', age: 22 }]
    t.setOptions({ data: next })
    // Same row objects in the new array: the previous hits map onto it.
    expect(ids(t)).toEqual([1, 3])
    await tick()
    expect(m.calls).toHaveLength(2)
    expect(m.last().ctx.rows).toBe(next)
    expect(slice(t).status).toBe('searching')
    m.last().resolve([next[4]])
    await tick()
    expect(ids(t)).toEqual([4])
    expect(slice(t)).toEqual({ input: 'a', query: 'a', status: 'idle' })
  })

  it('an initialState query runs searchFn once after creation; a failure is not retried in a loop', async () => {
    const searchFn = vi.fn(() => Promise.reject(new Error('down')))
    const t = createTable({
      data: users,
      onDiagnostic,
      columns: [{ key: 'name' }],
      features: [search<U>({ searchFn })],
      initialState: { search: { input: 'a', query: 'a', status: 'idle' } },
    })
    expect(t.getRowModel().rows).toHaveLength(4)
    await tick()
    await tick()
    expect(searchFn).toHaveBeenCalledTimes(1)
    expect(t.getState().search.status).toBe('error')
    t.getRowModel()
    await tick()
    expect(searchFn).toHaveBeenCalledTimes(1)
  })

  it("destroy() resolves an in-flight search 'superseded'; its late result is ignored", async () => {
    const m = manual()
    const t = make(m.searchFn)
    const p = t.setSearch('a')
    t.destroy()
    await expect(p).resolves.toEqual({ status: 'superseded' })
    m.last().resolve([users[0]])
    await tick()
    expect(codes()).not.toContain('DK_TABLE_DESTROYED')
  })

  it("searchFn replaces client matching: matching options and mode 'server' report no effect", () => {
    createTable({
      data: users,
      onDiagnostic,
      features: [search<U>({ searchFn: () => [], threshold: 0.5 })],
    })
    const d = seen.find((x) => x.code === 'DK_OPTION_NO_EFFECT')
    expect(d?.problem).toMatch(/threshold/)
    seen = []
    createTable({
      data: users,
      onDiagnostic,
      features: [search<U>({ mode: 'server', searchFn: () => [] })],
    })
    expect(seen.find((x) => x.code === 'DK_OPTION_NO_EFFECT')?.problem).toMatch(/searchFn/)
  })

  it('an invalid searchFn is DK_INVALID_OPTION', () => {
    expect(() =>
      createTable({ data: users, features: [search({ searchFn: 'x' as never })] }),
    ).toThrow(/DK_INVALID_OPTION|searchFn/)
  })
})
