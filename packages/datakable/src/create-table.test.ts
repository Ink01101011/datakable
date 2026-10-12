import {
  columnFilters,
  createTable as createCoreTable,
  type Diagnostic,
  type FetchResult,
  pagination,
  search,
  sorting,
  validity,
} from '@datakable/core'
import { describe, expect, it, vi } from 'vitest'
import { createTable, defaultFeatures } from './index'

type User = { id: number; name: string; age: number; city: string }
const cities = ['Bangkok', 'Chiang Mai', 'Khon Kaen']
const names = ['Mali', 'Anan', 'Ploy', 'Somchai', 'Nok']
const users: User[] = Array.from({ length: 40 }, (_, i) => ({
  id: i + 1,
  name: `${names[i % 5]} ${i + 1}`,
  age: 20 + ((i * 7) % 30),
  city: cities[i % 3] as string,
}))

const visible = (t: { getRowModel(): { rows: readonly { original: User }[] } }) =>
  t.getRowModel().rows.map((r) => r.original.id)

describe('zero-config createTable({ data }) (§3.3)', () => {
  it('installs the default preset with no other options', () => {
    const diagnostics: Diagnostic[] = []
    const t = createTable({ data: users, onDiagnostic: (d) => diagnostics.push(d) })
    expect(t.getState()).toEqual({
      columnFilters: {},
      validity: 'all',
      search: { input: '', query: '', status: 'idle' },
      sorting: { by: [] },
      pagination: { pageIndex: 0, pageSize: 10 },
    })
    const model = t.getRowModel()
    expect(model.totalCount).toBe(40)
    expect(model.filteredCount).toBe(40)
    expect(model.status).toBe('idle')
    expect(visible(t)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(diagnostics.filter((d) => d.level !== 'info')).toEqual([])
  })

  it('sorts, filters, searches and paginates on derived columns through the preset API', async () => {
    const t = createTable({ data: users })

    // sort: derived column `age`, asc then desc (stable: ties keep input order)
    t.toggleSort('age')
    const asc = [...users].sort((a, b) => a.age - b.age).map((u) => u.id)
    expect(visible(t)).toEqual(asc.slice(0, 10))
    expect(t.getSortDirection('age')).toBe('asc')

    // filter: derived column `city`
    t.setColumnFilter('city', { type: 'equals', value: 'Bangkok' })
    const bangkok = users.filter((u) => u.city === 'Bangkok')
    expect(t.getRowModel().filteredCount).toBe(bangkok.length)
    expect(visible(t)).toEqual(
      [...bangkok]
        .sort((a, b) => a.age - b.age)
        .map((u) => u.id)
        .slice(0, 10),
    )

    // paginate: page 2 of the filtered + sorted rows
    expect(t.getPageCount()).toBe(Math.ceil(bangkok.length / 10))
    expect(t.canNextPage()).toBe(true)
    t.nextPage()
    expect(t.getState().pagination.pageIndex).toBe(1)
    expect(visible(t)).toEqual(
      [...bangkok]
        .sort((a, b) => a.age - b.age)
        .map((u) => u.id)
        .slice(10),
    )

    // search: every derived column is searchable at weight 1 (zero-config, §6.3)
    await expect(t.setSearch('Somchai')).resolves.toEqual({ status: 'applied' })
    expect(t.getState().search.query).toBe('Somchai')
    const hits = t.getRowModel().rows.map((r) => r.original)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((u) => u.city === 'Bangkok' && u.name.startsWith('Somchai'))).toBe(true)

    t.clearSearch()
    t.resetColumnFilters()
    t.clearSorting()
    t.setPageIndex(0)
    expect(t.getRowModel().filteredCount).toBe(40)
    expect(visible(t)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('validity is a no-op without a schema (setting it reports DK_OPTION_NO_EFFECT)', () => {
    const codes: string[] = []
    const t = createTable({ data: users, onDiagnostic: (d) => codes.push(d.code) })
    t.setValidity('invalid')
    expect(t.getRowModel().filteredCount).toBe(40)
    expect(codes).toContain('DK_OPTION_NO_EFFECT')
  })

  it('passing features replaces the preset entirely', () => {
    const t = createTable({ data: users, features: [sorting()] })
    expect(Object.keys(t.getState())).toEqual(['sorting'])
    expect((t as unknown as Record<string, unknown>).setSearch).toBeUndefined()
    expect((t as unknown as Record<string, unknown>).nextPage).toBeUndefined()
    expect(t.getRowModel().rows).toHaveLength(40)
  })

  it('each table gets its own preset instances', () => {
    const a = createTable({ data: users })
    const b = createTable({ data: users })
    const fa = a.getOptions().features ?? []
    const fb = b.getOptions().features ?? []
    expect(fa.map((f) => f.name)).toEqual(defaultFeatures.map((f) => f.name))
    for (let i = 0; i < fa.length; i++) expect(fa[i]).not.toBe(fb[i])
  })

  it("datakable/core's createTable stays bare (no preset unless passed)", () => {
    expect(createCoreTable({ data: users }).getState()).toEqual({})
    expect(
      Object.keys(createCoreTable({ data: users, features: defaultFeatures }).getState()),
    ).toHaveLength(5)
  })
})

describe('zero-config createTable: async paths (T19 searchFn / refetch through the preset)', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0))

  it('zero-config: refetch() without a fetcher resolves; after destroy() setSearch still resolves', async () => {
    const t = createTable({ data: users, onDiagnostic: () => {} })
    await expect(t.refetch()).resolves.toEqual({ status: 'applied' })
    await expect(t.setSearch('Mali')).resolves.toEqual({ status: 'applied' })
    t.destroy()
    await expect(t.setSearch('Anan')).resolves.toEqual({ status: 'superseded' })
    await expect(t.flushSearch()).resolves.toEqual({ status: 'superseded' })
    await expect(t.refetch()).resolves.toEqual({ status: 'superseded' })
  })

  it('preset with search({ searchFn }) over fetched rows: search applies, refetch() recovers', async () => {
    const pending: { resolve: (r: FetchResult<User>) => void; reject: (e: unknown) => void }[] = []
    const fetcher = () =>
      new Promise<FetchResult<User>>((resolve, reject) => pending.push({ resolve, reject }))
    const searchFn = vi.fn(async ({ query, rows }: { query: string; rows: readonly User[] }) =>
      rows.filter((u) => u.city === query),
    )
    const t = createTable({
      fetcher,
      onDiagnostic: () => {},
      // the preset, with a server column filter first (§7.1) and a custom search
      features: [
        columnFilters({ mode: 'server' }),
        validity(),
        search<User>({ searchFn }),
        sorting(),
        pagination(),
      ],
    })
    pending[0]?.reject(new Error('down'))
    await tick()
    expect(t.getRowModel().status).toBe('error')

    const retry = t.refetch()
    expect(pending).toHaveLength(2)
    pending[1]?.resolve({ rows: users, rowCount: users.length })
    await expect(retry).resolves.toEqual({ status: 'applied' })
    expect(t.getRowModel().status).toBe('idle')
    expect(t.getRowModel().totalCount).toBe(40)

    const p = t.setSearch('Khon Kaen')
    await expect(p).resolves.toEqual({ status: 'applied' })
    expect(searchFn).toHaveBeenCalledTimes(1)
    expect(t.getRowModel().filteredCount).toBe(users.filter((u) => u.city === 'Khon Kaen').length)
    expect(t.getRowModel().rows.every((r) => r.original.city === 'Khon Kaen')).toBe(true)
  })
})
