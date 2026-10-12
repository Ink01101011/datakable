import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatakableConfigError } from '../diagnostics/build'
import type { AnyFeature } from '../feature/types'
import { columnFilters } from '../features/column-filters'
import { pagination } from '../features/pagination'
import { search } from '../features/search'
import { sorting } from '../features/sorting'
import { makeSchema } from '../ingest/test-schemas'
import { withSchema } from '../ingest/with-schema'
import { createTable } from '../table/create-table'
import { getTableInternals } from '../table/internals'
import type { FetchParams, FetchResult } from './fetcher'

/** Server search that commits on every keystroke (overrides the §6.3 server typing defaults). */
const serverNow = { mode: 'server', typing: { strategy: 'immediate', minLength: 0 } } as const

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
})

type P = { id: string; n: number }
const people = (n: number, from = 0): P[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${from + i}`, n: from + i }))
const api = (t: object) => t as unknown as Record<string, (...a: unknown[]) => unknown>
const codes = (t: { getDiagnostics(): readonly { code: string }[] }) =>
  t.getDiagnostics().map((d) => d.code)
const ns = (t: { getRowModel(): { rows: readonly { original: unknown }[] } }) =>
  t.getRowModel().rows.map((r) => (r.original as P).n)
const tick = () => new Promise((r) => setTimeout(r, 0))
const configError = (fn: () => unknown): DatakableConfigError => {
  try {
    fn()
  } catch (e) {
    if (e instanceof DatakableConfigError) return e
    throw e
  }
  throw new Error('expected a DatakableConfigError')
}

/** A fetcher whose requests the test settles by hand. */
function manual<T = P>() {
  const calls: {
    params: FetchParams
    resolve: (r: unknown) => void
    reject: (e: unknown) => void
  }[] = []
  const fetcher = vi.fn(
    (params: FetchParams) =>
      new Promise<FetchResult<T>>((resolve, reject) => {
        calls.push({ params, resolve: resolve as (r: unknown) => void, reject })
      }),
  )
  const last = () => calls[calls.length - 1] as (typeof calls)[number]
  return { fetcher, calls, last }
}

/** `[status, isInitialLoad]` of every notification. */
function watch(t: {
  subscribe(l: () => void): () => void
  getRowModel(): { status: string; isInitialLoad: boolean }
}) {
  const seen: [string, boolean][] = []
  t.subscribe(() => {
    const m = t.getRowModel()
    seen.push([m.status, m.isInitialLoad])
  })
  return seen
}

describe('mode per feature (§7.1)', () => {
  it('built-ins take mode (default client); an invalid mode is DK_INVALID_OPTION', () => {
    expect(sorting().mode).toBe('client')
    expect(pagination({ mode: 'server' }).mode).toBe('server')
    expect(search({ mode: 'server' }).mode).toBe('server')
    expect(columnFilters({ mode: 'server' }).mode).toBe('server')
    const e = configError(() =>
      createTable({ data: [], features: [sorting({ mode: 'serve' as 'server' })] }),
    )
    expect(e.diagnostic.code).toBe('DK_INVALID_OPTION')
    expect(e.diagnostic.fix.join(' ')).toContain("'server'")
  })

  it('a feature definition with an invalid mode is DK_INVALID_OPTION', () => {
    const f = { ...sorting(), mode: 'remote' } as unknown as AnyFeature
    expect(configError(() => createTable({ data: [], features: [f] })).diagnostic.code).toBe(
      'DK_INVALID_OPTION',
    )
  })

  it('server mode without a fetcher: state is held, the step is skipped', () => {
    const data = [
      { id: 'b', n: 2 },
      { id: 'a', n: 1 },
      { id: 'c', n: 3 },
    ]
    const t = createTable({
      data,
      columns: [{ key: 'n' }, { key: 'id' }],
      features: [columnFilters({ mode: 'server' }), sorting({ mode: 'server' })],
    })
    api(t).toggleSort?.('n')
    api(t).setColumnFilter?.('n', { type: 'equals', value: 1 })
    expect(t.getState().sorting).toEqual({ by: [{ id: 'n', desc: false }] })
    expect(ns(t)).toEqual([2, 1, 3])
  })

  it('DK_MODE_ORDER: a client step before a server step throws, naming both, two fixes', () => {
    const e = configError(() =>
      createTable({
        data: [],
        features: [sorting(), pagination({ mode: 'server' })],
      }),
    )
    expect(e.diagnostic.code).toBe('DK_MODE_ORDER')
    expect(e.diagnostic.problem).toContain('"pagination"')
    expect(e.diagnostic.problem).toContain('"sorting"')
    expect(e.diagnostic.fix).toHaveLength(2)
    expect(e.diagnostic.fix[0]).toContain("sorting({ mode: 'server' })")
    expect(e.diagnostic.fix[1]).toContain("pagination({ mode: 'client' })")
  })

  it('server filter + search, client sort + paginate is allowed (prefix)', () => {
    expect(() =>
      createTable({
        data: [],
        features: [
          columnFilters({ mode: 'server' }),
          search({ mode: 'server' }),
          sorting(),
          pagination(),
        ],
      }),
    ).not.toThrow()
  })
})

describe('DK_FETCHER_WITHOUT_SERVER_MODE (§7.1)', () => {
  it('throws at creation, naming the fix', () => {
    const e = configError(() =>
      createTable({ features: [sorting(), pagination()], fetcher: manual().fetcher }),
    )
    expect(e.diagnostic.code).toBe('DK_FETCHER_WITHOUT_SERVER_MODE')
    expect(e.diagnostic.where).toEqual({ kind: 'option', path: 'fetcher' })
    expect(e.diagnostic.fix[0]).toContain("mode: 'server'")
    expect(e.diagnostic.fix[0]).toContain('sorting, pagination')
    expect(e.diagnostic.fix[1]).toContain('remove fetcher')
  })

  it('throws on setOptions({ fetcher }) and keeps the previous options', () => {
    const t = createTable({ data: people(2), features: [sorting()] })
    const e = configError(() => t.setOptions({ fetcher: manual().fetcher }))
    expect(e.diagnostic.code).toBe('DK_FETCHER_WITHOUT_SERVER_MODE')
    expect(t.getOptions().fetcher).toBeUndefined()
  })
})

describe('fetcher (§7.1)', () => {
  it('runs at creation: fetching + isInitialLoad, then rows, idle, loaded (one notification)', async () => {
    const m = manual()
    const t = createTable({ fetcher: m.fetcher, features: [pagination({ mode: 'server' })] })
    expect(m.fetcher).toHaveBeenCalledTimes(1)
    expect(m.last().params).toEqual({ pageIndex: 0, pageSize: 10, signal: expect.any(AbortSignal) })
    const loading = t.getRowModel()
    expect([loading.status, loading.isInitialLoad, loading.rows.length]).toEqual([
      'fetching',
      true,
      0,
    ])
    const seen = watch(t)
    m.last().resolve({ rows: people(10), rowCount: 95 })
    await tick()
    expect(seen).toEqual([['idle', false]])
    expect(ns(t)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(api(t).getPageCount?.()).toBe(10)
    expect(api(t).canNextPage?.()).toBe(true)
    expect(t.getRowModel().filteredCount).toBe(10)
  })

  it('an empty result counts as loaded', async () => {
    const m = manual()
    const t = createTable({ fetcher: m.fetcher, features: [pagination({ mode: 'server' })] })
    m.last().resolve({ rows: [], rowCount: 0 })
    await tick()
    const r = t.getRowModel()
    expect([r.status, r.isInitialLoad]).toEqual(['idle', false])
    expect(api(t).getPageCount?.()).toBe(0)
  })

  it('a page change refetches: notified at start (stale rows shown) and at end', async () => {
    const m = manual()
    const t = createTable({ fetcher: m.fetcher, features: [pagination({ mode: 'server' })] })
    m.last().resolve({ rows: people(10), rowCount: 95 })
    await tick()
    const seen = watch(t)
    api(t).nextPage?.()
    expect(m.fetcher).toHaveBeenCalledTimes(2)
    expect(m.last().params.pageIndex).toBe(1)
    expect(seen).toEqual([['fetching', false]])
    expect(ns(t)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    m.last().resolve({ rows: people(10, 10), rowCount: 95 })
    await tick()
    expect(seen).toEqual([
      ['fetching', false],
      ['idle', false],
    ])
    expect(ns(t)[0]).toBe(10)
  })

  it('the pageIndex from initialState is kept while the first request is in flight', async () => {
    const m = manual()
    const t = createTable({
      fetcher: m.fetcher,
      features: [pagination({ mode: 'server' })],
      initialState: { pagination: { pageIndex: 3, pageSize: 10 } },
    })
    expect(m.last().params.pageIndex).toBe(3)
    m.last().resolve({ rows: people(10, 30), rowCount: 95 })
    await tick()
    expect(t.getState().pagination.pageIndex).toBe(3)
    expect(m.fetcher).toHaveBeenCalledTimes(1)
  })

  it('a sort change plus the page auto-reset is one request', async () => {
    const m = manual()
    const t = createTable({
      fetcher: m.fetcher,
      columns: [{ key: 'n' }],
      features: [sorting({ mode: 'server' }), pagination({ mode: 'server' })],
      initialState: { pagination: { pageIndex: 2, pageSize: 10 } },
    })
    m.last().resolve({ rows: people(10, 20), rowCount: 95 })
    await tick()
    api(t).toggleSort?.('n')
    expect(m.fetcher).toHaveBeenCalledTimes(2)
    expect(m.last().params).toMatchObject({ sort: [{ id: 'n', desc: false }], pageIndex: 0 })
  })

  it('params carry only server-mode state; client steps run on the fetched rows', async () => {
    const m = manual()
    const t = createTable({
      fetcher: m.fetcher,
      columns: [{ key: 'n' }, { key: 'id' }],
      // Immediate typing (the server default debounces, §6.3): each setSearch commits at once.
      features: [columnFilters({ mode: 'server' }), search(serverNow), sorting()],
    })
    expect(Object.keys(m.last().params).sort()).toEqual(['filters', 'query', 'signal'])
    m.last().resolve({ rows: people(3) })
    await tick()
    api(t).toggleSort?.('n')
    api(t).toggleSort?.('n')
    expect(ns(t)).toEqual([2, 1, 0])
    // A client-step change does not refetch.
    expect(m.fetcher).toHaveBeenCalledTimes(1)
    void api(t).setSearch?.('ada')
    expect(m.fetcher).toHaveBeenCalledTimes(2)
    expect(m.last().params.query).toBe('ada')
    api(t).setColumnFilter?.('n', { type: 'equals', value: 1 })
    expect(m.last().params.filters).toEqual({ n: { type: 'equals', value: 1 } })
  })

  it('latest wins: a superseded result is ignored (DK_FETCH_ABORTED, signal aborted)', async () => {
    const m = manual()
    const t = createTable({ fetcher: m.fetcher, features: [pagination({ mode: 'server' })] })
    m.last().resolve({ rows: people(10), rowCount: 95 })
    await tick()
    api(t).setPageIndex?.(1)
    const first = m.last()
    api(t).setPageIndex?.(2)
    expect(first.params.signal.aborted).toBe(true)
    expect(t.getRowModel().status).toBe('fetching')
    m.last().resolve({ rows: people(10, 20), rowCount: 95 })
    first.resolve({ rows: people(10, 10), rowCount: 95 })
    await tick()
    expect(ns(t)[0]).toBe(20)
    expect(t.getRowModel().status).toBe('idle')
    expect(codes(t)).toContain('DK_FETCH_ABORTED')
    expect(t.getDiagnostics().find((d) => d.code === 'DK_FETCH_ABORTED')?.level).toBe('info')
  })

  it("a rejection: DK_FETCH_FAILED, previous rows kept, 'error' until a request applies", async () => {
    const m = manual()
    const onDiagnostic = vi.fn()
    const t = createTable({
      fetcher: m.fetcher,
      features: [pagination({ mode: 'server' })],
      onDiagnostic,
    })
    m.last().resolve({ rows: people(10), rowCount: 95 })
    await tick()
    const seen = watch(t)
    api(t).nextPage?.()
    const boom = new TypeError('Failed to fetch')
    m.last().reject(boom)
    await tick()
    expect(seen).toEqual([
      ['fetching', false],
      ['error', false],
    ])
    expect(ns(t)[0]).toBe(0)
    const d = onDiagnostic.mock.calls.map((c) => c[0]).find((x) => x.code === 'DK_FETCH_FAILED')
    expect(d.context.cause).toBe(boom)
    expect(d.where).toEqual({ kind: 'option', path: 'fetcher' })
    expect(d.problem).toContain('TypeError')
    expect(d.context.trigger).toBe('fetch')
    expect(d.context.mode).toEqual({ pagination: 'server' })
    // The retry is in flight while 'error' wins (precedence), then it recovers.
    api(t).nextPage?.()
    expect(t.getRowModel().status).toBe('error')
    m.last().resolve({ rows: people(10, 20), rowCount: 95 })
    await tick()
    expect(t.getRowModel().status).toBe('idle')
    expect(ns(t)[0]).toBe(20)
  })

  it("a failed first request: 'error' with isInitialLoad true", async () => {
    const m = manual()
    const t = createTable({
      fetcher: m.fetcher,
      features: [pagination({ mode: 'server' })],
      onDiagnostic: () => {},
    })
    const seen = watch(t)
    m.last().reject(new Error('500'))
    await tick()
    expect(seen).toEqual([['error', true]])
    const r = t.getRowModel()
    expect(r.rows).toHaveLength(0)
    expect(t.getDiagnostics().find((d) => d.code === 'DK_FETCH_FAILED')?.impact).toContain(
      'isInitialLoad: true',
    )
  })

  it('a fetcher that throws synchronously is DK_FETCH_FAILED', () => {
    const t = createTable({
      fetcher: () => {
        throw new RangeError('bad')
      },
      features: [pagination({ mode: 'server' })],
      onDiagnostic: () => {},
    })
    return tick().then(() => {
      expect(codes(t)).toContain('DK_FETCH_FAILED')
      expect(t.getRowModel().status).toBe('error')
    })
  })

  it.each([
    ['not-an-object', null],
    ['not-an-object', [1, 2]],
    ['rows-not-an-array', { rowCount: 3 }],
    ['rowCount-missing', { rows: people(2) }],
    ['rowCount-invalid', { rows: people(2), rowCount: 2.5 }],
    ['rowCount-invalid', { rows: people(2), rowCount: '2' }],
    ['rowCount-too-small', { rows: people(3), rowCount: 2 }],
  ])('bad response (%s): DK_FETCH_BAD_RESPONSE, previous rows kept', async (problem, value) => {
    const m = manual()
    const t = createTable({
      fetcher: m.fetcher,
      features: [pagination({ mode: 'server' })],
      onDiagnostic: () => {},
    })
    m.last().resolve({ rows: people(10), rowCount: 95 })
    await tick()
    api(t).nextPage?.()
    m.last().resolve(value)
    await tick()
    const d = t.getDiagnostics().find((x) => x.code === 'DK_FETCH_BAD_RESPONSE')
    expect(d?.details).toMatchObject({ problem })
    expect(d?.fix.length).toBeGreaterThan(0)
    expect(t.getRowModel().status).toBe('error')
    expect(ns(t)[0]).toBe(0)
  })

  it('rowCount may be left out without server pagination (rows.length)', async () => {
    const m = manual()
    const t = createTable({ fetcher: m.fetcher, features: [sorting({ mode: 'server' })] })
    m.last().resolve({ rows: people(4) })
    await tick()
    expect(t.getRowModel().status).toBe('idle')
    expect(getTableInternals(t).rowCount()).toBe(4)
  })

  it('schema validation and data checks apply to the fetched rows', async () => {
    const schema = withSchema(
      makeSchema<P>((v) =>
        typeof (v as P).n === 'number'
          ? { value: v as P }
          : { issues: [{ message: 'n', path: ['n'] }] },
      ),
    )
    const m = manual<unknown>()
    const t = createTable({
      schema,
      fetcher: m.fetcher,
      features: [sorting({ mode: 'server' })],
      onDiagnostic: () => {},
    })
    m.last().resolve({ rows: [{ id: 'a', n: 1 }, { id: 'b' }] })
    await tick()
    expect(t.getRowModel().rows.map((r) => r.original.id)).toEqual(['a'])
    expect(t.getInvalidRows()).toHaveLength(1)
    expect(codes(t)).toContain('DK_SCHEMA_INVALID_ROW')
  })

  it("timeout: DK_ASYNC_TIMEOUT and 'error'", async () => {
    vi.useFakeTimers()
    const m = manual()
    const t = createTable({
      fetcher: m.fetcher,
      timeout: 50,
      features: [pagination({ mode: 'server' })],
      onDiagnostic: () => {},
    })
    await vi.advanceTimersByTimeAsync(60)
    expect(m.last().params.signal.aborted).toBe(true)
    expect(codes(t)).toContain('DK_ASYNC_TIMEOUT')
    expect(t.getRowModel().status).toBe('error')
  })

  it('destroy aborts the request: no notification, no diagnostic', async () => {
    const m = manual()
    const t = createTable({ fetcher: m.fetcher, features: [pagination({ mode: 'server' })] })
    const seen = watch(t)
    t.destroy()
    expect(m.last().params.signal.aborted).toBe(true)
    m.last().resolve({ rows: people(3), rowCount: 3 })
    await tick()
    expect(seen).toEqual([])
    expect(codes(t)).not.toContain('DK_FETCH_FAILED')
  })

  it('strict: a failed fetch rethrows nowhere unhandled and still ends in error', async () => {
    const m = manual()
    const t = createTable({
      fetcher: m.fetcher,
      strict: true,
      features: [pagination({ mode: 'server' })],
      onDiagnostic: () => {},
    })
    m.last().reject(new Error('x'))
    await tick()
    expect(t.getRowModel().status).toBe('error')
  })
})

describe("status 'searching' (async searchFn seam, §6.6)", () => {
  it("a searchFn request is 'searching'; a fetcher overlapping it wins ('fetching')", async () => {
    const m = manual()
    const t = createTable({ fetcher: m.fetcher, features: [search(serverNow)] })
    m.last().resolve({ rows: people(2) })
    await tick()
    const seen = watch(t)
    let done: (v: unknown) => void = () => {}
    const p = getTableInternals(t).request(
      'searchFn',
      () =>
        new Promise((r) => {
          done = r
        }),
    )
    expect(seen).toEqual([['searching', false]])
    void api(t).setSearch?.('x')
    expect(t.getRowModel().status).toBe('fetching')
    m.last().resolve({ rows: people(1) })
    await tick()
    expect(t.getRowModel().status).toBe('searching')
    done(['r'])
    await expect(p).resolves.toEqual({ value: ['r'], status: 'applied' })
    expect(t.getRowModel().status).toBe('idle')
    expect(seen.map((s) => s[0])).toEqual(['searching', 'fetching', 'searching', 'idle'])
  })
})

describe('property: 4 steps × 2 modes (§7.1)', () => {
  const steps = ['filter', 'search', 'sort', 'paginate'] as const
  type Mode = 'client' | 'server'
  const make = (modes: readonly Mode[]) => [
    columnFilters({ mode: modes[0] as Mode }),
    search({ mode: modes[1] as Mode }),
    sorting({ mode: modes[2] as Mode }),
    pagination({ mode: modes[3] as Mode, pageSize: 2 }),
  ]
  const KEYS: Record<(typeof steps)[number], string[]> = {
    filter: ['filters'],
    search: ['query'],
    sort: ['sort'],
    paginate: ['pageIndex', 'pageSize'],
  }

  it('DK_MODE_ORDER iff the server steps are not a prefix; else the fetcher gets exactly their state', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(...steps.map(() => fc.constantFrom('client' as const, 'server' as const))),
        async (modes) => {
          const firstClient = modes.indexOf('client')
          const prefix = firstClient === -1 || !modes.slice(firstClient).includes('server')
          const anyServer = modes.includes('server')
          const m = manual()
          const create = () =>
            createTable({
              columns: [{ key: 'n' }],
              features: make(modes),
              ...(anyServer ? { fetcher: m.fetcher } : { data: people(5) }),
            })
          if (!prefix) {
            expect(configError(create).diagnostic.code).toBe('DK_MODE_ORDER')
            return
          }
          const t = create()
          if (!anyServer) {
            expect(ns(t)).toEqual([0, 1])
            return
          }
          const expected = steps.flatMap((s, i) => (modes[i] === 'server' ? KEYS[s] : []))
          expect(
            Object.keys(m.last().params)
              .filter((k) => k !== 'signal')
              .sort(),
          ).toEqual(expected.sort())
          m.last().resolve({ rows: people(5), rowCount: 5 })
          await tick()
          // Client sort desc reverses the fetched rows; client paging shows 2 of them.
          if (modes[2] === 'client') {
            api(t).toggleSort?.('n')
            api(t).toggleSort?.('n')
          }
          const shown = ns(t)
          expect(shown).toHaveLength(modes[3] === 'client' ? 2 : 5)
          if (modes[2] === 'client') expect(shown[0]).toBe(4)
          expect(m.fetcher).toHaveBeenCalledTimes(1)
        },
      ),
      { numRuns: 32 },
    )
  })
})
