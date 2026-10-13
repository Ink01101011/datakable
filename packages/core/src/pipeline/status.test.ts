import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineFeature } from '../feature/define'
import type { AnyFeature } from '../feature/types'
import { columnFilters } from '../features/column-filters/column-filters'
import { pagination } from '../features/pagination'
import { search } from '../features/search/search'
import { withSearchFn } from '../features/search/with-search-fn'
import { makeSchema } from '../ingest/test-schemas'
import { withSchema } from '../ingest/with-schema'
import { defineInterceptor } from '../intercept/define'
import { requestsOf } from '../source/requests'
import { withFetcher } from '../source/with-fetcher'
import { createTable } from '../table/create-table'

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

type P = { id: string; n: number }
const people = (n: number): P[] => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, n: i }))
const api = (t: object) => t as unknown as Record<string, (...a: unknown[]) => unknown>

describe('RowModel.isInitialLoad (§6.6)', () => {
  it('false once data given at creation produced a row model (an empty array counts)', () => {
    expect(createTable({ data: people(2) }).getRowModel().isInitialLoad).toBe(false)
    expect(createTable({ data: [] }).getRowModel().isInitialLoad).toBe(false)
  })

  it('true without data until data is applied; then a new row model and a notification', () => {
    const t = createTable<P>({})
    const first = t.getRowModel()
    expect(first.isInitialLoad).toBe(true)
    expect(first.rows).toHaveLength(0)
    const listener = vi.fn()
    t.subscribe(listener)
    t.setOptions({ data: [] })
    expect(listener).toHaveBeenCalledTimes(1)
    const next = t.getRowModel()
    expect(next).not.toBe(first)
    expect(next.isInitialLoad).toBe(false)
  })

  it('never goes back to true', () => {
    const t = createTable<P>({ data: people(1) })
    t.setOptions({ data: [] })
    expect(t.getRowModel().isInitialLoad).toBe(false)
    t.setOptions({ columns: [{ key: 'n' }] })
    expect(t.getRowModel().isInitialLoad).toBe(false)
  })

  it('an async ingest: true until the creation data is applied', async () => {
    const t = createTable<P>({
      data: people(2),
      interceptors: [
        defineInterceptor({
          name: 'async',
          on: ['data:ingest'],
          intercept: (_ctx, next) => Promise.resolve(next()),
        }),
      ],
    })
    expect(t.getRowModel().isInitialLoad).toBe(true)
    const listener = vi.fn()
    t.subscribe(listener)
    await new Promise((r) => setTimeout(r, 0))
    expect(listener).toHaveBeenCalled()
    const m = t.getRowModel()
    expect(m.isInitialLoad).toBe(false)
    expect(m.rows).toHaveLength(2)
  })
})

describe('status is never silent (§6.6)', () => {
  it("'error' from a failing rowModel and recovery to 'idle': new object + notification each", () => {
    let fail = false
    const flaky = defineFeature({
      name: 'flaky',
      stage: 'filter',
      initialState: () => ({ v: 0 }),
      createApi: (ctx) => ({ bump: () => ctx.setState((s) => ({ v: s.v + 1 })) }),
      rowModel: (indices) => {
        if (fail) throw new Error('boom')
        return indices
      },
    }) as AnyFeature
    const t = createTable({ data: people(3), features: [flaky], onDiagnostic: () => {} })
    const idle = t.getRowModel()
    expect(idle.status).toBe('idle')

    const seen: string[] = []
    t.subscribe(() => {
      seen.push(t.getRowModel().status)
    })

    fail = true
    api(t).bump?.()
    const error = t.getRowModel()
    expect(error.status).toBe('error')
    expect(error).not.toBe(idle)
    // Same visible rows (the step passed its input through), still a new object.
    const at = (m: { rows: readonly { index: number }[] }) => m.rows.map((r) => r.index)
    expect(at(error)).toEqual(at(idle))

    fail = false
    api(t).bump?.()
    const recovered = t.getRowModel()
    expect(recovered.status).toBe('idle')
    expect(recovered).not.toBe(error)
    expect(seen).toEqual(['error', 'idle'])
  })

  it("'error' when pipeline:run fails, back to 'idle' on good data: notified both times", () => {
    const data = people(2)
    const t = createTable<P>({ data, onDiagnostic: () => {} })
    const good = t.getRowModel()
    const seen: string[] = []
    t.subscribe(() => {
      seen.push(t.getRowModel().status)
    })
    const broken = new Proxy(people(3), {
      get(target, p, r) {
        if (typeof p === 'string' && /^\d+$/.test(p)) throw new Error('unreadable row')
        return Reflect.get(target, p, r)
      },
    })
    t.setOptions({ data: broken })
    const error = t.getRowModel()
    expect(error.status).toBe('error')
    expect(error).not.toBe(good)
    t.setOptions({ data })
    const recovered = t.getRowModel()
    expect(recovered.status).toBe('idle')
    expect(recovered).not.toBe(error)
    expect(seen).toEqual(['error', 'idle'])
  })
})

describe("a failed data:ingest sets 'error' and never counts as loaded (§6.6, §8.6)", () => {
  // Interceptor failures are skipped (§3.4), so a failing ingest is a failing core: here the
  // schema step reading a data Proxy that throws (fault injection).
  type V = { id: string; n: number }
  const schema = withSchema(
    makeSchema<V>((v) =>
      typeof (v as V).n === 'number'
        ? { value: v as V }
        : { issues: [{ message: 'n', path: ['n'] }] },
    ),
  )
  const asyncSchema = withSchema(
    makeSchema<V>((v) => schema['~standard'].validate(v) as never, {
      async: true,
    }),
  )
  /** `rows`, but throws once more than `reads` element reads were made (or on `length`). */
  const unreadable = (rows: unknown[], reads = -1) => {
    let n = 0
    return new Proxy(rows, {
      get(target, p, r) {
        if (reads < 0 && p === 'length') throw new Error('unreadable data')
        if (typeof p === 'string' && /^\d+$/.test(p) && reads >= 0 && ++n > reads) {
          throw new Error('unreadable row')
        }
        return Reflect.get(target, p, r)
      },
    })
  }

  it("sync failure at creation: 'error', isInitialLoad stays true; a good ingest recovers", () => {
    const t = createTable({ schema, data: unreadable(people(2)), onDiagnostic: () => {} })
    const m = t.getRowModel()
    expect(m.status).toBe('error')
    expect(m.isInitialLoad).toBe(true)
    expect(m.rows).toHaveLength(0)
    const seen: [string, boolean][] = []
    t.subscribe(() => {
      const r = t.getRowModel()
      seen.push([r.status, r.isInitialLoad])
    })
    t.setOptions({ data: people(3) })
    expect(seen).toEqual([['idle', false]])
    expect(t.getRowModel().totalCount).toBe(3)
  })

  it("failure on setOptions: previous rows kept with 'error', notified", () => {
    const t = createTable({ schema, data: people(2), onDiagnostic: () => {} })
    const good = t.getRowModel()
    const seen: string[] = []
    t.subscribe(() => {
      seen.push(t.getRowModel().status)
    })
    t.setOptions({ data: unreadable(people(5)) })
    const error = t.getRowModel()
    expect(error.status).toBe('error')
    expect(error).not.toBe(good)
    expect(error.totalCount).toBe(2)
    expect(error.isInitialLoad).toBe(false)
    expect(seen).toEqual(['error'])
  })

  it("an async ingest that fails: 'error' when it settles, not loaded", async () => {
    // Row 1 is invalid: settling it reads the row again, past the allowed reads.
    const rows = [{ id: 'a', n: 1 }, { id: 'b' }]
    const t = createTable({
      schema: asyncSchema,
      data: unreadable(rows, rows.length),
      onDiagnostic: () => {},
    })
    expect(t.getRowModel().status).toBe('validating')
    const statuses: string[] = []
    t.subscribe(() => {
      statuses.push(t.getRowModel().status)
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(statuses).toEqual(['error'])
    const m = t.getRowModel()
    expect(m.isInitialLoad).toBe(true)
    expect(m.rows).toHaveLength(0)
  })
})

describe("'fetching' is never silent (§6.6, §7.1)", () => {
  const server = () => pagination({ mode: 'server' })
  function manual() {
    const calls: { resolve: (r: unknown) => void; reject: (e: unknown) => void }[] = []
    const fetcher = () =>
      new Promise<never>((resolve, reject) => {
        calls.push({ resolve: resolve as (r: unknown) => void, reject })
      })
    return { fetcher, last: () => calls[calls.length - 1] as (typeof calls)[number] }
  }
  const tick = () => new Promise((r) => setTimeout(r, 0))
  const track = (t: {
    subscribe(l: () => void): () => void
    getRowModel(): { status: string; isInitialLoad: boolean }
  }) => {
    const seen: [string, boolean][] = []
    t.subscribe(() => {
      const m = t.getRowModel()
      seen.push([m.status, m.isInitialLoad])
    })
    return seen
  }

  it('fetch start notifies with a new row model', async () => {
    const m = manual()
    const t = createTable({ fetcher: withFetcher(m.fetcher), features: [server()] })
    m.last().resolve({ rows: people(10), rowCount: 30 })
    await tick()
    const idle = t.getRowModel()
    const seen = track(t)
    api(t).nextPage?.()
    expect(seen).toEqual([['fetching', false]])
    expect(t.getRowModel()).not.toBe(idle)
  })

  it('fetch end notifies with a new row model', async () => {
    const m = manual()
    const t = createTable({ fetcher: withFetcher(m.fetcher), features: [server()] })
    const fetching = t.getRowModel()
    expect([fetching.status, fetching.isInitialLoad]).toEqual(['fetching', true])
    const seen = track(t)
    m.last().resolve({ rows: people(10), rowCount: 30 })
    await tick()
    expect(seen).toEqual([['idle', false]])
    expect(t.getRowModel()).not.toBe(fetching)
  })

  it("first-fetch failure: 'error' with isInitialLoad true, notified", async () => {
    const m = manual()
    const t = createTable({
      fetcher: withFetcher(m.fetcher),
      features: [server()],
      onDiagnostic: () => {},
    })
    const seen = track(t)
    m.last().reject(new Error('down'))
    await tick()
    expect(seen).toEqual([['error', true]])
  })

  it("a superseded request keeps 'fetching' without an extra notification", async () => {
    const m = manual()
    const t = createTable({ fetcher: withFetcher(m.fetcher), features: [server()] })
    m.last().resolve({ rows: people(10), rowCount: 30 })
    await tick()
    const seen = track(t)
    api(t).setPageIndex?.(1)
    api(t).setPageIndex?.(2)
    await tick()
    expect(seen).toEqual([
      ['fetching', false],
      ['fetching', false],
    ])
    m.last().resolve({ rows: people(10), rowCount: 30 })
    await tick()
    expect(seen.at(-1)).toEqual(['idle', false])
    expect(seen).toHaveLength(3)
  })

  it("precedence: 'fetching' over 'validating' (async schema on fetched rows)", async () => {
    const schema = withSchema(makeSchema<P>((v) => ({ value: v as P }), { async: true }))
    const m = manual()
    const t = createTable({ schema, fetcher: withFetcher(m.fetcher), features: [server()] })
    const seen = track(t)
    m.last().resolve({ rows: people(10), rowCount: 30 })
    await tick()
    await tick()
    expect(seen.map((s) => s[0])).toEqual(['validating', 'idle'])
    expect(t.getRowModel().isInitialLoad).toBe(false)
  })
})

describe('overlapping sources compose: error > fetching > searching > validating > pending > idle', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetch + searchFn + async schema + debounced search: the top source wins, each change notifies once', async () => {
    vi.useFakeTimers()
    const flush = () => vi.advanceTimersByTimeAsync(0)
    let openGate = () => {}
    const gate = new Promise<void>((r) => {
      openGate = r
    })
    const schema = withSchema(makeSchema<P>((v) => ({ value: v as P }), { async: () => gate }))
    let resolveFetch: (r: unknown) => void = () => {}
    const fetcher = () =>
      new Promise<never>((r) => {
        resolveFetch = r as (r: unknown) => void
      })
    const t = createTable({
      schema,
      fetcher: withFetcher(fetcher),
      columns: [{ key: 'id', search: 1 }],
      // Server steps come first (DK_MODE_ORDER): server filters, client search on the fetched rows.
      features: [
        columnFilters({ mode: 'server' }),
        search({ typing: { strategy: 'debounce', wait: 100 } }),
      ],
    })
    const seen: [string, boolean][] = []
    t.subscribe(() => {
      const m = t.getRowModel()
      seen.push([m.status, m.isInitialLoad])
    })
    expect(t.getRowModel().status).toBe('fetching')

    // pending (typing) under fetching: the state change notifies, the status stays 'fetching'.
    void api(t).setSearch?.('p1')
    expect(t.getState().search).toMatchObject({ status: 'pending' })
    expect(seen).toEqual([['fetching', true]])

    // searching under fetching: masked, so no notification.
    let resolveSearch: (v: unknown) => void = () => {}
    void requestsOf(t).request(
      'searchFn',
      () =>
        new Promise((r) => {
          resolveSearch = r
        }),
    )
    expect(seen).toHaveLength(1)
    expect(t.getRowModel().status).toBe('fetching')

    // fetch ends while searchFn runs and the fetched rows validate: 'searching'.
    resolveFetch({ rows: people(3), rowCount: 3 })
    await flush()
    expect(seen.slice(1)).toEqual([['searching', true]])

    // searchFn ends: async validation still runs, search still pending: 'validating'.
    resolveSearch(undefined)
    await flush()
    expect(seen.slice(2)).toEqual([['validating', true]])

    // validation ends: rows applied, debounce still waiting: 'pending'.
    openGate()
    await flush()
    expect(seen.slice(3)).toEqual([['pending', false]])

    // the debounce commits the query: 'idle'.
    await vi.advanceTimersByTimeAsync(100)
    expect(seen.slice(4)).toEqual([['idle', false]])
    expect(t.getRowModel().rows.map((r) => (r.original as P).id)).toEqual(['p1'])
  })

  it("'error' beats everything in flight", async () => {
    vi.useFakeTimers()
    let rejectFetch: (e: unknown) => void = () => {}
    const fetcher = () =>
      new Promise<never>((_r, rej) => {
        rejectFetch = rej
      })
    const t = createTable({
      fetcher: withFetcher<{ id: number }>(fetcher),
      onDiagnostic: () => {},
      columns: [{ key: 'id', search: 1 }],
      // Server steps come first (DK_MODE_ORDER): server filters, client search on the fetched rows.
      features: [
        columnFilters({ mode: 'server' }),
        search({ typing: { strategy: 'debounce', wait: 100 } }),
      ],
    })
    void api(t).setSearch?.('p1')
    void requestsOf(t).request('searchFn', () => new Promise(() => {}))
    const seen: string[] = []
    t.subscribe(() => seen.push(t.getRowModel().status))
    rejectFetch(new Error('down'))
    await vi.advanceTimersByTimeAsync(0)
    expect(seen).toEqual(['error'])
  })
})

describe("'pending' while time-sliced work runs (§6.6, §9.1; USER DECISION)", () => {
  /** A filter whose result comes from a sliced job (every yield ends a slice: fast clock). */
  const sliced = () => {
    const key = {}
    return defineFeature({
      name: 'sliced',
      stage: 'filter',
      initialState: () => ({ on: false }),
      createApi: (ctx) => ({ turnOn: () => ctx.setState({ on: true }) }),
      rowModel: (indices, state, ctx) => {
        if (!state.on) return indices
        const out = ctx.slice?.(key, function* () {
          yield
          yield
          return indices.subarray(0, 1)
        })
        return out ?? indices
      },
    }) as AnyFeature
  }

  beforeEach(() => {
    vi.stubGlobal('document', {})
    let clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 100))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("start and end each notify with a new row model: 'pending' → 'idle'", async () => {
    const t = createTable({ data: people(3), features: [sliced()], onDiagnostic: () => {} })
    const idle = t.getRowModel()
    const seen: [string, number][] = []
    t.subscribe(() => {
      const m = t.getRowModel()
      seen.push([m.status, m.rows.length])
    })
    api(t).turnOn?.()
    const pending = t.getRowModel()
    expect(pending).not.toBe(idle)
    expect(seen).toEqual([['pending', 3]])
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))
    expect(seen).toEqual([
      ['pending', 3],
      ['idle', 1],
    ])
    expect(t.getRowModel()).not.toBe(pending)
    expect(t.getRowModel().isInitialLoad).toBe(false)
  })

  it("an in-flight searchFn ranks above 'pending' (precedence)", async () => {
    const t = createTable({
      data: people(3),
      onDiagnostic: () => {},
      features: [sliced(), search({ searchFn: withSearchFn(() => new Promise<P[]>(() => {})) })],
    })
    t.getRowModel()
    api(t).turnOn?.()
    expect(t.getRowModel().status).toBe('pending')
    void api(t).setSearch?.('p')
    expect(t.getRowModel().status).toBe('searching')
  })
})
