import { ExSearch } from 'ex-search'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from '../diagnostics/types'
import { defineFeature } from '../feature/define'
import type { AnyFeature } from '../feature/types'
import { search } from '../features/search/search'
import { withSearchFn } from '../features/search/with-search-fn'
import { sorting } from '../features/sorting/sorting'
import { defineInterceptor } from '../intercept/define'
import { createTable } from '../table/create-table'
import { runJob, SLICE_MS } from './slice'

// Time-slicing (§9.1, §6.6). Slicing needs a browser phase (`document`, else the run is SSR and
// synchronous) and a table that already has a row model. A fast clock (every reading +100 ms)
// makes every `yield` end the slice, so jobs go async deterministically with tiny data.

let seen: Diagnostic[]
const onDiagnostic = (d: Diagnostic) => {
  seen.push(d)
}
const of = (code: string) => seen.filter((d) => d.code === code)

let clock = 0
const fastClock = () =>
  vi.spyOn(performance, 'now').mockImplementation(() => {
    clock += 100
    return clock
  })

/** Lets every pending slice run (setTimeout fallback: one macrotask per slice). */
async function settle(rounds = 200) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  seen = []
  vi.stubGlobal('document', {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type P = { id: number; name: string }
const people = (n: number): P[] =>
  Array.from({ length: n }, (_, i) => ({ id: i, name: `name ${i}` }))
const at = (m: { rows: readonly { index: number }[] }) => m.rows.map((r) => r.index)

/** A filter whose kept set comes from a sliced job of `steps` yields (keeps even rows). */
function slicedFilter(steps: number, opts: { throwAt?: number } = {}) {
  const key = {}
  const jobs = vi.fn()
  const feature = defineFeature({
    name: 'evens',
    stage: 'filter',
    initialState: () => ({ on: false }),
    createApi: (ctx) => ({ turnOn: () => ctx.setState({ on: true }) }),
    rowModel: (indices, state, ctx) => {
      if (!state.on) return indices
      const keep = ctx.slice?.(key, function* () {
        jobs()
        for (let i = 0; i < steps; i++) {
          if (i === opts.throwAt) throw new Error('job failed')
          yield
        }
        return indices.filter((r) => r % 2 === 0)
      })
      return keep ?? indices
    },
  }) as AnyFeature
  return { feature, jobs }
}
const api = (t: object) => t as unknown as { turnOn(): void }

describe('ctx.slice: the runner contract (§9.1)', () => {
  it('a job that fits in one slice is synchronous: no pending, no async step', () => {
    const { feature } = slicedFilter(3)
    const t = createTable({ data: people(6), features: [feature], onDiagnostic })
    t.getRowModel()
    api(t).turnOn()
    const m = t.getRowModel()
    expect(m.status).toBe('idle')
    expect(at(m)).toEqual([0, 2, 4])
  })

  it("a longer job: 'pending' with the previous rows, then the result; both notified", async () => {
    fastClock()
    const { feature, jobs } = slicedFilter(5)
    const t = createTable({ data: people(6), features: [feature], onDiagnostic })
    const first = t.getRowModel()
    const statuses: string[] = []
    t.subscribe(() => {
      statuses.push(t.getRowModel().status)
    })
    api(t).turnOn()
    const pending = t.getRowModel()
    expect(pending.status).toBe('pending')
    expect(pending).not.toBe(first)
    expect(at(pending)).toEqual(at(first))
    expect(statuses).toEqual(['pending'])
    // A later run while the job runs asks for the same job: not restarted.
    t.setState({})
    expect(t.getRowModel().status).toBe('pending')
    await settle()
    const done = t.getRowModel()
    expect(done.status).toBe('idle')
    expect(at(done)).toEqual([0, 2, 4])
    expect(statuses).toEqual(['pending', 'idle'])
    expect(jobs).toHaveBeenCalledTimes(1)
  })

  it("the table's first row model is never sliced (SSR / hydration parity)", () => {
    fastClock()
    const { feature } = slicedFilter(5)
    const t = createTable({
      data: people(6),
      features: [feature],
      initialState: { evens: { on: true } },
      onDiagnostic,
    })
    const m = t.getRowModel()
    expect(m.status).toBe('idle')
    expect(at(m)).toEqual([0, 2, 4])
  })

  it('no slicing during SSR (no document): the run completes synchronously', () => {
    vi.unstubAllGlobals()
    fastClock()
    const { feature } = slicedFilter(5)
    const t = createTable({ data: people(6), features: [feature], onDiagnostic })
    t.getRowModel()
    api(t).turnOn()
    expect(t.getRowModel().status).toBe('idle')
    expect(at(t.getRowModel())).toEqual([0, 2, 4])
  })

  it('pending ranks below the other statuses (§6.6 precedence): error wins', async () => {
    fastClock()
    const { feature } = slicedFilter(5)
    let fail = false
    const flaky = defineFeature({
      name: 'flaky',
      stage: 'sort',
      initialState: () => ({}),
      createApi: () => ({}),
      rowModel: (indices) => {
        if (fail) throw new Error('boom')
        return indices
      },
    }) as AnyFeature
    const t = createTable({ data: people(6), features: [feature, flaky], onDiagnostic })
    t.getRowModel()
    fail = true
    t.setState({ evens: { on: true }, flaky: {} })
    expect(t.getRowModel().status).toBe('error')
    fail = false
    t.setState({ flaky: {} })
    expect(t.getRowModel().status).toBe('pending')
    await settle()
    expect(t.getRowModel().status).toBe('idle')
  })

  it('a job that throws in a later slice fails its step (DK_FEATURE_FAILED), no rejection', async () => {
    fastClock()
    const { feature } = slicedFilter(5, { throwAt: 3 })
    const t = createTable({ data: people(6), features: [feature], onDiagnostic })
    const before = at(t.getRowModel())
    api(t).turnOn()
    expect(t.getRowModel().status).toBe('pending')
    await settle()
    const m = t.getRowModel()
    expect(m.status).toBe('error')
    expect(at(m)).toEqual(before)
    expect(of('DK_FEATURE_FAILED')[0]?.where).toEqual({ kind: 'feature', name: 'evens' })
  })

  it('destroy() stops sliced work: no later notification', async () => {
    fastClock()
    const { feature } = slicedFilter(50)
    const t = createTable({ data: people(6), features: [feature], onDiagnostic })
    t.getRowModel()
    const listener = vi.fn()
    t.subscribe(listener)
    api(t).turnOn()
    expect(listener).toHaveBeenCalledTimes(1)
    t.destroy()
    await settle()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('scheduler.yield() between slices when present; else setTimeout + DK_ENV_FALLBACK once', async () => {
    fastClock()
    const { feature } = slicedFilter(5)
    const t = createTable({ data: people(6), features: [feature], onDiagnostic })
    t.getRowModel()
    api(t).turnOn()
    await settle()
    const fallback = of('DK_ENV_FALLBACK')
    expect(fallback).toHaveLength(1)
    expect(fallback[0]?.details).toMatchObject({ api: 'scheduler.yield', fallback: 'setTimeout' })
    expect(fallback[0]?.where).toEqual({ kind: 'feature', name: 'evens' })
    expect(fallback[0]?.level).toBe('info')
    expect(fallback[0]?.fix.length).toBeGreaterThan(0)

    seen = []
    const yieldFn = vi.fn(() => Promise.resolve())
    vi.stubGlobal('scheduler', { yield: yieldFn })
    const second = slicedFilter(5)
    const u = createTable({ data: people(6), features: [second.feature], onDiagnostic })
    u.getRowModel()
    api(u).turnOn()
    await settle()
    expect(yieldFn).toHaveBeenCalled()
    expect(u.getRowModel().status).toBe('idle')
    expect(of('DK_ENV_FALLBACK')).toHaveLength(0)
  })

  it('runJob runs a job to completion (replay, contexts without slicing)', () => {
    expect(
      runJob(function* () {
        yield
        yield
        return 42
      }),
    ).toBe(42)
    expect(SLICE_MS).toBeLessThan(50)
  })
})

type U = { id: number; name: string; city: string }
const CITIES = ['Bangkok', 'Chiang Mai', 'Phuket', 'Ada Town', 'Hat Yai']
const users = (n: number): U[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i,
    name: `${['Ada', 'Bob', 'Cara', 'Dan', 'Eve'][i % 5]} ${(i * 7919) % 1000}`,
    city: CITIES[(i * 31) % CITIES.length] as string,
  }))
const columns = [
  { key: 'name' as const, search: 1 },
  { key: 'city' as const, search: 0.5 },
]

describe('search: sliced projection and matching (§6.3, §9.1)', () => {
  it("first query: 'pending' (previous rows) while the projection builds, then the results", async () => {
    const data = users(30)
    const sync = createTable({ data, columns, features: [search()] })
    sync.getRowModel()
    await sync.setSearch('ada')
    const expected = at(sync.getRowModel())
    expect(expected.length).toBeGreaterThan(0)

    fastClock()
    const t = createTable({ data, columns, features: [search()], onDiagnostic })
    const all = at(t.getRowModel())
    const statuses: string[] = []
    t.subscribe(() => statuses.push(t.getRowModel().status))
    const p = t.setSearch('ada')
    expect(t.getRowModel().status).toBe('pending')
    expect(at(t.getRowModel())).toEqual(all)
    await settle()
    expect(t.getRowModel().status).toBe('idle')
    expect(at(t.getRowModel())).toEqual(expected)
    expect(statuses.at(0)).toBe('pending')
    expect(statuses.at(-1)).toBe('idle')
    await expect(p).resolves.toEqual({ status: 'applied' })
  })

  it('a later query keeps showing the previous results while matching runs', async () => {
    // Matching yields between chunks (16,384 cells / 2 columns = 8192 rows): more than one.
    const data = users(10_000)
    fastClock()
    const t = createTable({ data, columns, features: [search()], onDiagnostic })
    t.getRowModel()
    void t.setSearch('ada')
    await settle()
    const ada = at(t.getRowModel())
    void t.setSearch('bob')
    expect(t.getRowModel().status).toBe('pending')
    expect(at(t.getRowModel())).toEqual(ada)
    await settle()
    expect(t.getRowModel().status).toBe('idle')
    expect(at(t.getRowModel())).not.toEqual(ada)
  })

  it('a newer query while matching runs: the stale job is dropped, the newest applies', async () => {
    const data = users(30)
    const sync = createTable({ data, columns, features: [search()] })
    sync.getRowModel()
    await sync.setSearch('cara')
    const expected = at(sync.getRowModel())

    fastClock()
    const t = createTable({ data, columns, features: [search()], onDiagnostic })
    t.getRowModel()
    void t.setSearch('ada')
    void t.setSearch('bob')
    void t.setSearch('cara')
    await settle()
    expect(t.getRowModel().status).toBe('idle')
    expect(at(t.getRowModel())).toEqual(expected)
  })

  // #6: the promises resolve 'applied' only once the row model reflects the query (not 'pending').
  it("setSearch / flushSearch resolve 'applied' only when the sliced row model reflects the query", async () => {
    const data = users(10_000)
    const sync = createTable({ data, columns, features: [search()] })
    sync.getRowModel()
    await sync.setSearch('ada')
    const expected = at(sync.getRowModel())

    fastClock()
    const t = createTable({ data, columns, features: [search()], onDiagnostic })
    t.getRowModel()
    const seenAt = (o: { status: string }) => ({
      outcome: o.status,
      status: t.getRowModel().status,
      rows: at(t.getRowModel()),
    })
    const first = t.setSearch('ada').then(seenAt)
    await settle()
    expect(await first).toEqual({ outcome: 'applied', status: 'idle', rows: expected })

    const t2 = createTable({
      data,
      columns,
      features: [search({ typing: { commitOn: 'enter' } })],
      onDiagnostic,
    })
    t2.getRowModel()
    void t2.setSearch('ada')
    const flushed = t2.flushSearch().then((o) => ({
      outcome: o.status,
      status: t2.getRowModel().status,
      n: t2.getRowModel().rows.length,
    }))
    await settle()
    expect(await flushed).toEqual({ outcome: 'applied', status: 'idle', n: expected.length })
  })

  it("a newer query, cancelSearch() or destroy() during sliced work: 'superseded'", async () => {
    const data = users(10_000)
    fastClock()
    const mk = () => {
      const t = createTable({ data, columns, features: [search()], onDiagnostic })
      t.getRowModel()
      return t
    }
    let t = mk()
    const older = t.setSearch('ada')
    const newer = t.setSearch('bob')
    await settle()
    await expect(older).resolves.toEqual({ status: 'superseded' })
    await expect(newer).resolves.toEqual({ status: 'applied' })
    expect(t.getRowModel().status).toBe('idle')

    t = mk()
    const cancelled = t.setSearch('ada')
    t.cancelSearch()
    await expect(cancelled).resolves.toEqual({ status: 'superseded' })

    t = mk()
    const destroyed = t.setSearch('ada')
    t.destroy()
    await expect(destroyed).resolves.toEqual({ status: 'superseded' })
  })

  it('matching in chunks equals one ex-search pass over every row (more than one chunk)', async () => {
    vi.unstubAllGlobals() // synchronous (SSR) run: same chunked code, no slicing
    const data = users(10_000)
    const t = createTable({ data, columns, features: [search()] })
    await t.setSearch('cara 1')
    const got = t.getRowModel()

    const engine = new ExSearch<{ i: number; c0: string; c1: string }>({
      keys: [
        { name: 'c0', weight: 1 },
        { name: 'c1', weight: 0.5 },
      ],
      threshold: 0.3,
      fuzzyMaxDistance: 3,
      caseSensitive: false,
      sortAlgorithm: 'tim',
    })
    engine.setData(data.map((u, i) => ({ i, c0: u.name, c1: u.city })))
    const hits = engine.search('cara 1') as unknown as { i: number; score: number }[]
    const expected = hits
      .slice()
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map((h) => h.i)
    expect(got.filteredCount).toBe(expected.length)
    expect(at(got)).toEqual(expected.slice(0, got.rows.length))
  })

  it('a slow formatted column is formatted in time-sliced batches, each row once (#40)', async () => {
    // Dates and a `format` that throws on every 7th row (a date column is searched once it has a
    // weight, #27).
    const data = Array.from({ length: 3000 }, (_, i) => ({
      id: i,
      name: `name ${i}`,
      when: new Date(Date.UTC(2020, 0, 1 + (i % 365))),
    }))
    const format = vi.fn((d: Date) => {
      if (d.getUTCDate() % 7 === 0) throw new RangeError('bad day')
      return d.toISOString().slice(0, 10)
    })
    const cols = [
      { key: 'name' as const, search: 1 },
      { key: 'when' as const, search: 1, format },
    ]
    const sync = createTable({ data, columns: cols, features: [search()] })
    sync.getRowModel()
    await sync.setSearch('2020-03-14')
    const expected = at(sync.getRowModel())
    expect(expected.length).toBeGreaterThan(0)
    format.mockClear()

    const batches: number[] = []
    fastClock() // every batch ends the slice
    const t = createTable({
      data,
      columns: cols,
      features: [search()],
      onDiagnostic,
      interceptors: [
        defineInterceptor({
          name: 'format-batches',
          on: ['column:batch'],
          hot: true,
          intercept: (c, next) => {
            if (c.input.slot === 'format') batches.push(c.input.rows.length)
            return next()
          },
        }),
      ],
    })
    t.getRowModel()
    const p = t.setSearch('2020-03-14')
    expect(t.getRowModel().status).toBe('pending')
    await settle()
    await expect(p).resolves.toEqual({ status: 'applied' })
    expect(at(t.getRowModel())).toEqual(expected)
    // Not one 3000-row task: several batches covering every row exactly once.
    expect(batches.length).toBeGreaterThan(1)
    expect(batches.every((rows) => rows <= 512)).toBe(true)
    expect(batches.reduce((a, b) => a + b, 0)).toBe(data.length)
    expect(format).toHaveBeenCalledTimes(data.length)
    // Failures are counted over the whole column: one diagnostic.
    const failed = of('DK_CALLBACK_FAILED')
    expect(failed).toHaveLength(1)
    expect(failed[0]?.details).toMatchObject({
      slot: 'columns[1].format',
      count: data.filter((u) => u.when.getUTCDate() % 7 === 0).length,
    })
  })

  it('explainRow replays reuse the built projection and leave the sliced job alone', async () => {
    const data = users(40)
    fastClock()
    const setData = vi.spyOn(ExSearch.prototype, 'setData')
    const t = createTable({ data, columns, rowKey: 'id', features: [search()], onDiagnostic })
    t.getRowModel()
    void t.setSearch('ada')
    await settle()
    const full = () => setData.mock.calls.filter(([items]) => items.length === data.length).length
    expect(full()).toBe(1)
    const removed = data.find((u) => !u.name.startsWith('Ada')) as U
    expect(t.explainRow(removed.id).steps.length).toBeGreaterThan(0)
    expect(full()).toBe(1)
    expect(t.getRowModel().status).toBe('idle')
  })

  it('a searchFn result applied again for the same rows keeps the row model (no new arrays)', async () => {
    const data = users(10)
    const t = createTable({
      data,
      columns,
      rowKey: 'id',
      features: [
        search({
          searchFn: withSearchFn(({ rows }) => rows.slice(0, 3)),
          typing: { commitOn: 'enter' },
        }),
      ],
    })
    void t.setSearch('x')
    await t.flushSearch()
    const m = t.getRowModel()
    expect(m.rows).toHaveLength(3)
    // Typing with commitOn 'enter' changes the slice (input) only: the step re-runs on the same
    // input and hits, and returns its previous output, so the row model object is kept.
    void t.setSearch('xy')
    expect(t.getRowModel()).toBe(m)
  })
})

describe('sorting: collation ranks for string columns at n ≥ 10k (§6.4, §9.1)', () => {
  const n = 12_000
  const words = ['item 10', 'item 2', 'Item 1', 'banana', 'Äpfel', 'apfel', 'Å', 'Å', 'zeta']
  const rows = Array.from({ length: n }, (_, i) => ({
    id: i,
    s: i % 97 === 0 ? null : i % 89 === 0 ? undefined : (words[(i * 7) % words.length] as string),
  }))
  const collator = new Intl.Collator(undefined, { numeric: true })
  /** The default comparator's order: collator, missing last both ways, stable by index. */
  const reference = (desc: boolean) =>
    rows
      .map((_, i) => i)
      .sort((a, b) => {
        const x = (rows[a] as { s: string | null | undefined }).s
        const y = (rows[b] as { s: string | null | undefined }).s
        const xm = x == null
        const ym = y == null
        if (xm || ym) return xm === ym ? a - b : xm ? 1 : -1
        return (desc ? -1 : 1) * collator.compare(x, y) || a - b
      })

  it('same order as the collator comparator, both directions; reported as collation ranks', () => {
    const t = createTable({
      data: rows,
      columns: [{ key: 's' }],
      features: [sorting({ debug: true })],
      onDiagnostic,
    })
    ;(t as unknown as { toggleSort(id: string): void }).toggleSort('s')
    const all = (m: { rows: readonly { index: number }[] }) => m.rows.map((r) => r.index)
    expect(all(t.getRowModel())).toEqual(reference(false))
    expect(String(of('DK_SORT_STRATEGY')[0]?.details.reason)).toContain('collation ranks')
    ;(t as unknown as { toggleSort(id: string): void }).toggleSort('s')
    expect(all(t.getRowModel())).toEqual(reference(true))
  })

  it('multi-column sorts use the ranks too (same order)', () => {
    const data = rows.map((r) => ({ ...r, k: r.id % 3 }))
    const t = createTable({
      data,
      columns: [{ key: 's' }, { key: 'k' }],
      features: [sorting()],
    })
    ;(t as unknown as { setSorting(by: unknown): void }).setSorting([
      { id: 'k', desc: false },
      { id: 's', desc: true },
    ])
    const got = t.getRowModel().rows.map((r) => r.index)
    const ref = reference(true)
    const pos = new Map(ref.map((r, p) => [r, p]))
    const expected = data
      .map((_, i) => i)
      .sort(
        (a, b) =>
          (data[a]?.k as number) - (data[b]?.k as number) ||
          (pos.get(a) as number) - (pos.get(b) as number),
      )
    expect(got).toEqual(expected)
  })

  it("sliced: 'pending' with the previous order, then sorted (no long task)", async () => {
    fastClock()
    const t = createTable({ data: rows, columns: [{ key: 's' }], features: [sorting()] })
    const unsorted = t.getRowModel().rows.map((r) => r.index)
    ;(t as unknown as { toggleSort(id: string): void }).toggleSort('s')
    expect(t.getRowModel().status).toBe('pending')
    expect(t.getRowModel().rows.map((r) => r.index)).toEqual(unsorted)
    await settle(2000)
    expect(t.getRowModel().status).toBe('idle')
    expect(t.getRowModel().rows.map((r) => r.index)).toEqual(reference(false))
    // The ranks are kept per column values: the other direction sorts at once.
    ;(t as unknown as { toggleSort(id: string): void }).toggleSort('s')
    expect(t.getRowModel().status).toBe('idle')
    expect(t.getRowModel().rows.map((r) => r.index)).toEqual(reference(true))
  })
})
