import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DatakableError } from '../diagnostics/build'
import { defineInterceptor } from '../intercept/define'
import { minFilter, numSort } from '../pipeline/test-features'
import { createTable } from '../table/create-table'
import { pagination } from './pagination'

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

type P = { id: string; n: number }
const people = (n: number): P[] => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, n: i }))
const ids = (t: { getRowModel(): { rows: readonly { original: unknown }[] } }) =>
  t.getRowModel().rows.map((r) => (r.original as P).n)
const api = (t: object) => t as unknown as Record<string, (...a: unknown[]) => unknown>
const codes = (t: { getDiagnostics(): readonly { code: string }[] }) =>
  t.getDiagnostics().map((d) => d.code)

describe('pagination() — state and row model (§6.5)', () => {
  it('starts at { pageIndex: 0, pageSize: 10 } and shows the first page', () => {
    const t = createTable({ data: people(25), features: [pagination()] })
    expect(t.getState().pagination).toEqual({ pageIndex: 0, pageSize: 10 })
    expect(ids(t)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    const m = t.getRowModel()
    expect(m.filteredCount).toBe(25)
    expect(m.totalCount).toBe(25)
  })

  it('the pageSize option sets the starting page size', () => {
    const t = createTable({ data: people(25), features: [pagination({ pageSize: 4 })] })
    expect(t.getState().pagination).toEqual({ pageIndex: 0, pageSize: 4 })
    expect(ids(t)).toEqual([0, 1, 2, 3])
  })

  it('options.initialState.pagination wins over the option', () => {
    const t = createTable({
      data: people(25),
      features: [pagination({ pageSize: 4 })],
      initialState: { pagination: { pageIndex: 2, pageSize: 5 } },
    })
    expect(ids(t)).toEqual([10, 11, 12, 13, 14])
  })

  it('an invalid pageSize option is a config error', () => {
    expect(() =>
      createTable({ data: people(3), features: [pagination({ pageSize: 0 })] }),
    ).toThrowError(DatakableError)
    expect(() =>
      createTable({ data: people(3), features: [pagination({ pageSize: 2.5 })] }),
    ).toThrowError(/DK_INVALID_OPTION|pageSize/)
  })

  it('omitting the feature means no pagination', () => {
    const t = createTable({ data: people(25) })
    expect(t.getRowModel().rows).toHaveLength(25)
  })

  it('a last partial page, and an empty table', () => {
    const t = createTable({
      data: people(25),
      features: [pagination()],
      initialState: { pagination: { pageIndex: 2, pageSize: 10 } },
    })
    expect(ids(t)).toEqual([20, 21, 22, 23, 24])
    const e = createTable({ data: [] as P[], features: [pagination()] })
    expect(e.getRowModel().rows).toEqual([])
    expect(e.getPageCount()).toBe(0)
    expect(e.canNextPage()).toBe(false)
    expect(e.canPrevPage()).toBe(false)
  })
})

describe('pagination() — API', () => {
  it('nextPage / prevPage / canNextPage / canPrevPage / getPageCount', () => {
    const t = createTable({ data: people(25), features: [pagination()] })
    expect(t.getPageCount()).toBe(3)
    expect(t.canPrevPage()).toBe(false)
    expect(t.canNextPage()).toBe(true)
    t.nextPage()
    expect(t.getState().pagination.pageIndex).toBe(1)
    expect(ids(t)[0]).toBe(10)
    t.nextPage()
    expect(t.canNextPage()).toBe(false)
    t.nextPage() // no-op at the end
    expect(t.getState().pagination.pageIndex).toBe(2)
    t.prevPage()
    t.prevPage()
    expect(t.canPrevPage()).toBe(false)
    t.prevPage() // no-op at the start
    expect(t.getState().pagination.pageIndex).toBe(0)
  })

  it('setPageIndex clamps to [0, pageCount - 1]', () => {
    const t = createTable({ data: people(25), features: [pagination()] })
    t.setPageIndex(2)
    expect(ids(t)[0]).toBe(20)
    t.setPageIndex(99)
    expect(t.getState().pagination.pageIndex).toBe(2)
    t.setPageIndex(-3)
    expect(t.getState().pagination.pageIndex).toBe(0)
  })

  it('one notification per API call', () => {
    const t = createTable({ data: people(25), features: [pagination()] })
    const listener = vi.fn()
    t.subscribe(listener)
    t.nextPage()
    expect(listener).toHaveBeenCalledTimes(1)
    t.setPageSize(5)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('an invalid API argument is ignored with DK_INVALID_PAGINATION (never silent)', () => {
    const onDiagnostic = vi.fn()
    const t = createTable({ data: people(25), features: [pagination()], onDiagnostic })
    t.setPageIndex(1)
    api(t).setPageIndex?.(Number.NaN)
    api(t).setPageIndex?.(1.5)
    api(t).setPageSize?.(0)
    api(t).setPageSize?.('20')
    expect(t.getState().pagination).toEqual({ pageIndex: 1, pageSize: 10 })
    const ds = onDiagnostic.mock.calls.map((c) => c[0])
    // Deduped per code + where: one report per method.
    expect(new Set(ds.map((d) => d.code))).toEqual(new Set(['DK_INVALID_PAGINATION']))
    expect(ds.map((d) => d.where.op)).toEqual(['table.setPageIndex', 'table.setPageSize'])
    expect(ds[0].details.received).toBe('NaN')
    const d = ds[1]
    expect(d.level).toBe('warn')
    expect(d.where).toEqual({ kind: 'operation', op: 'table.setPageSize' })
    expect(d.details.received).toBe('0') // first report: setPageSize(0)
    expect(d.fix.length).toBeGreaterThan(0)
  })
})

describe('pagination() — page-size anchor', () => {
  it('setPageSize keeps the first visible row on screen: floor(firstRow / newSize)', () => {
    const t = createTable({ data: people(100), features: [pagination()] })
    t.setPageIndex(3) // rows 30..39
    t.setPageSize(25)
    expect(t.getState().pagination).toEqual({ pageIndex: 1, pageSize: 25 }) // 25..49 contains 30
    expect(ids(t)).toContain(30)
    t.setPageSize(7) // first row 25 → page 3 (21..27)
    expect(t.getState().pagination).toEqual({ pageIndex: 3, pageSize: 7 })
    expect(ids(t)).toContain(25)
    t.setPageSize(100)
    expect(t.getState().pagination).toEqual({ pageIndex: 0, pageSize: 100 })
  })

  it('anchors on the visible first row when the stored pageIndex is past the end', () => {
    const t = createTable({
      data: people(25),
      features: [pagination()],
      initialState: { pagination: { pageIndex: 9, pageSize: 10 } },
    })
    // Visible page is the last one (20..24); the anchor is row 20.
    expect(ids(t)[0]).toBe(20)
    t.setPageSize(5)
    expect(t.getState().pagination).toEqual({ pageIndex: 4, pageSize: 5 })
  })
})

describe('pagination() — clamp when the row count shrinks', () => {
  it('data shrinks: pageIndex is clamped to the new last page', () => {
    const t = createTable({ data: people(50), features: [pagination()] })
    t.setPageIndex(4)
    const listener = vi.fn()
    t.subscribe(listener)
    t.setOptions({ data: people(23) })
    expect(t.getState().pagination.pageIndex).toBe(2)
    expect(ids(t)).toEqual([20, 21, 22])
    expect(listener).toHaveBeenCalled()
    expect(listener.mock.lastCall?.[0].pagination.pageIndex).toBe(2)
  })

  it('data emptied: pageIndex goes to 0', () => {
    const t = createTable({ data: people(50), features: [pagination()] })
    t.setPageIndex(3)
    t.setOptions({ data: [] })
    expect(t.getState().pagination.pageIndex).toBe(0)
    expect(t.getRowModel().rows).toEqual([])
  })

  it('filters shrink the rows with autoResetPageIndex: false', () => {
    const t = createTable({
      data: people(50),
      features: [minFilter('n'), pagination({ autoResetPageIndex: false })],
      columns: [{ key: 'n' }],
    })
    t.setPageIndex(4)
    api(t).setMin?.(35) // 15 rows left → 2 pages
    expect(t.getState().pagination.pageIndex).toBe(1)
    expect(ids(t)).toEqual([45, 46, 47, 48, 49])
  })

  it('the visible page is clamped even before the state is (never an empty page past the end)', () => {
    const t = createTable({
      data: people(12),
      features: [pagination()],
      initialState: { pagination: { pageIndex: 5, pageSize: 10 } },
    })
    expect(ids(t)).toEqual([10, 11])
    expect(t.canNextPage()).toBe(false)
    expect(t.canPrevPage()).toBe(true)
  })

  it('async ingest that shrinks the data is clamped too', async () => {
    let async = false
    const t = createTable({
      data: people(50),
      features: [pagination()],
      interceptors: [
        defineInterceptor({
          name: 'maybeAsync',
          on: ['data:ingest'],
          intercept: (_ctx, next) => (async ? Promise.resolve(next()) : next()),
        }),
      ],
    })
    t.setPageIndex(4)
    async = true
    t.setOptions({ data: people(15) })
    await new Promise((r) => setTimeout(r, 0))
    expect(t.getState().pagination.pageIndex).toBe(1)
    expect(ids(t)).toEqual([10, 11, 12, 13, 14])
  })
})

describe('pagination() — autoResetPageIndex (default true)', () => {
  const make = (opts?: { autoResetPageIndex?: boolean }) =>
    createTable({
      data: people(100),
      features: [minFilter('n'), numSort('n'), pagination(opts)],
      columns: [{ key: 'n' }],
    })

  it('a filter change resets to page 0 in the same notification', () => {
    const t = make()
    t.setPageIndex(3)
    const listener = vi.fn()
    t.subscribe(listener)
    api(t).setMin?.(10)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.lastCall?.[0].pagination.pageIndex).toBe(0)
    expect(ids(t)[0]).toBe(10)
  })

  it('a sort change resets to page 0', () => {
    const t = make()
    t.setPageIndex(3)
    api(t).setSort?.('desc')
    expect(t.getState().pagination.pageIndex).toBe(0)
    expect(ids(t)[0]).toBe(99)
  })

  it('table.setState on a filter slice resets too; a pagination change in the same update wins', () => {
    const t = make()
    t.setPageIndex(3)
    t.setState({ minFilter: { min: 1 } })
    expect(t.getState().pagination.pageIndex).toBe(0)
    t.setState({ minFilter: { min: 2 }, pagination: { pageIndex: 2, pageSize: 10 } })
    expect(t.getState().pagination.pageIndex).toBe(2)
  })

  it('controlled filter state changed through setOptions({ state }) resets too', () => {
    const t = createTable({
      data: people(100),
      features: [minFilter('n'), pagination()],
      columns: [{ key: 'n' }],
      state: { minFilter: { min: undefined } },
      onStateChange: () => {},
    })
    t.setPageIndex(3)
    t.setOptions({ state: { minFilter: { min: 5 } } })
    expect(t.getState().pagination.pageIndex).toBe(0)
  })

  it('autoResetPageIndex: false keeps the page', () => {
    const t = make({ autoResetPageIndex: false })
    t.setPageIndex(3)
    api(t).setSort?.('desc')
    expect(t.getState().pagination.pageIndex).toBe(3)
  })

  it('a data change alone does not reset (only search, filters or sort)', () => {
    const t = make()
    t.setPageIndex(3)
    t.setOptions({ data: people(100).slice() })
    expect(t.getState().pagination.pageIndex).toBe(3)
  })

  it('controlled pagination: the reset goes to onStateChange', () => {
    const onStateChange = vi.fn()
    const t = createTable({
      data: people(100),
      features: [minFilter('n'), pagination()],
      columns: [{ key: 'n' }],
      state: { pagination: { pageIndex: 3, pageSize: 10 } },
      onStateChange,
    })
    api(t).setMin?.(10)
    const update = onStateChange.mock.calls
      .map((c) => c[0]({}))
      .find((u: Record<string, unknown>) => 'pagination' in u)
    expect(update?.pagination).toEqual({ pageIndex: 0, pageSize: 10 })
  })
})

describe('pagination() — invalid state is replaced, never silent', () => {
  it('setState with a bad slice: replaced with DK_INVALID_PAGINATION', () => {
    const t = createTable({ data: people(30), features: [pagination({ pageSize: 5 })] })
    t.setState({ pagination: { pageIndex: -1, pageSize: 0 } })
    expect(t.getState().pagination).toEqual({ pageIndex: 0, pageSize: 5 })
    expect(codes(t)).toContain('DK_INVALID_PAGINATION')
    const d = t.getDiagnostics().find((x) => x.code === 'DK_INVALID_PAGINATION')
    expect(d?.where).toEqual({ kind: 'option', path: 'state.pagination.pageIndex' })
    expect(ids(t)).toEqual([0, 1, 2, 3, 4])
  })

  it('a bad initialState slice is replaced at creation', () => {
    const t = createTable({
      data: people(30),
      features: [pagination()],
      initialState: { pagination: { pageIndex: 1, pageSize: Number.NaN } },
    })
    expect(t.getState().pagination).toEqual({ pageIndex: 1, pageSize: 10 })
    expect(codes(t)).toContain('DK_INVALID_PAGINATION')
    expect(ids(t)[0]).toBe(10)
  })

  it('a non-object slice is replaced by the initial state', () => {
    const t = createTable({ data: people(30), features: [pagination()] })
    t.setState({ pagination: null as never })
    expect(t.getState().pagination).toEqual({ pageIndex: 0, pageSize: 10 })
    expect(codes(t)).toContain('DK_INVALID_PAGINATION')
  })
})

describe('pagination() — lifecycle', () => {
  it('API calls after destroy are no-ops (DK_TABLE_DESTROYED)', () => {
    const t = createTable({ data: people(30), features: [pagination()] })
    t.destroy()
    t.nextPage()
    expect(codes(t)).toContain('DK_TABLE_DESTROYED')
  })

  it('one feature instance can serve two tables independently', () => {
    const p = pagination({ pageSize: 5 })
    const a = createTable({
      data: people(30),
      features: [minFilter('n'), p],
      columns: [{ key: 'n' }],
    })
    const b = createTable({
      data: people(30),
      features: [minFilter('n'), p],
      columns: [{ key: 'n' }],
    })
    a.setPageIndex(2)
    b.setPageIndex(3)
    api(a).setMin?.(1)
    expect(a.getState().pagination.pageIndex).toBe(0)
    expect(b.getState().pagination.pageIndex).toBe(3)
  })
})

describe('pagination({ mode: "server" }) without a fetcher (§6.5, §7.1)', () => {
  it('data is the current page; the page count comes from the rowCount option', () => {
    const t = createTable({
      data: people(10),
      rowCount: 95,
      features: [pagination({ mode: 'server' })],
    })
    expect(ids(t)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(api(t).getPageCount?.()).toBe(10)
    expect(api(t).canNextPage?.()).toBe(true)
    api(t).setPageIndex?.(9)
    expect(t.getState().pagination.pageIndex).toBe(9)
    // The app fetched page 9 (5 rows): no slicing, no clamping.
    t.setOptions({ data: people(95).slice(90) })
    expect(ids(t)).toEqual([90, 91, 92, 93, 94])
    expect(t.getState().pagination.pageIndex).toBe(9)
    expect(api(t).canNextPage?.()).toBe(false)
    expect(codes(t)).not.toContain('DK_ROW_COUNT_MISSING')
  })

  it('a smaller rowCount clamps pageIndex', () => {
    const t = createTable({
      data: people(10),
      rowCount: 95,
      features: [pagination({ mode: 'server' })],
      initialState: { pagination: { pageIndex: 8, pageSize: 10 } },
    })
    t.setOptions({ rowCount: 30 })
    expect(t.getState().pagination.pageIndex).toBe(2)
  })

  it('without rowCount: DK_ROW_COUNT_MISSING (warn) and data.length as the total', () => {
    const t = createTable({ data: people(10), features: [pagination({ mode: 'server' })] })
    expect(api(t).getPageCount?.()).toBe(1)
    expect(api(t).canNextPage?.()).toBe(false)
    const d = t.getDiagnostics().filter((x) => x.code === 'DK_ROW_COUNT_MISSING')
    expect(d).toHaveLength(1)
    expect(d[0]?.level).toBe('warn')
    expect(d[0]?.where).toEqual({ kind: 'option', path: 'rowCount' })
    expect(d[0]?.fix[0]).toContain('rowCount')
  })

  it('rowCount without server pagination is DK_OPTION_NO_EFFECT; invalid is DK_INVALID_OPTION', () => {
    const t = createTable({ data: people(3), rowCount: 3, features: [pagination()] })
    expect(codes(t)).toContain('DK_OPTION_NO_EFFECT')
    expect(() => createTable({ data: people(3), rowCount: -1 })).toThrow(DatakableError)
  })
})
