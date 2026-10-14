import { ExSearch } from 'ex-search'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from '../../diagnostics/types'
import { minFilter, numSort } from '../../pipeline/test-features'
import { createTable } from '../../table/create-table'
import { search } from './search'
import { rankHits } from './search-index'

let seen: Diagnostic[]
const onDiagnostic = (d: Diagnostic) => {
  seen.push(d)
}
const codes = () => seen.map((d) => d.code)

beforeEach(() => {
  seen = []
  vi.restoreAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

type U = { id: number; name: string; city: string; age: number; tags: string[] }
const users: U[] = [
  { id: 0, name: 'Adams', city: 'Bangkok', age: 31, tags: ['red'] },
  { id: 1, name: 'Ada', city: 'Chiang Mai', age: 25, tags: ['blue', 'green'] },
  { id: 2, name: 'Bob', city: 'Ada Town', age: 40, tags: [] },
  { id: 3, name: 'Ada', city: 'Phuket', age: 19, tags: ['blue'] },
  { id: 4, name: 'Cara', city: 'Bangkok', age: 52, tags: ['red'] },
]

const ids = (t: { getRowModel(): { rows: readonly { original: { id: number } }[] } }) =>
  t.getRowModel().rows.map((r) => r.original.id)

const make = (opts: Parameters<typeof search>[0] = {}, data: readonly U[] = users) =>
  createTable({
    data,
    onDiagnostic,
    columns: [{ key: 'name', search: 1 }, { key: 'city', search: 0.5 }, { key: 'age' }],
    features: [search(opts)],
  })

describe('search(): state and API (§6.3)', () => {
  it('initial state matches the spec shape', () => {
    const t = make()
    expect(t.getState().search).toEqual({ input: '', query: '', status: 'idle' })
  })

  it('setSearch applies input and query immediately and resolves { status: applied }', async () => {
    const t = make()
    const listener = vi.fn()
    t.subscribe(listener)
    const p = t.setSearch('ada')
    expect(t.getState().search).toEqual({ input: 'ada', query: 'ada', status: 'idle' })
    expect(listener).toHaveBeenCalledTimes(1)
    await expect(p).resolves.toEqual({ status: 'applied' })
  })

  it('setSearch with the current value changes nothing (no notification)', async () => {
    const t = make()
    await t.setSearch('ada')
    const listener = vi.fn()
    t.subscribe(listener)
    await expect(t.setSearch('ada')).resolves.toEqual({ status: 'applied' })
    expect(listener).not.toHaveBeenCalled()
  })

  it('flushSearch commits input to query; clearSearch empties both; cancelSearch is safe', async () => {
    const t = make()
    t.setState({ search: { input: 'bob', query: '', status: 'idle' } })
    expect(ids(t)).toEqual([0, 1, 2, 3, 4])
    await expect(t.flushSearch()).resolves.toEqual({ status: 'applied' })
    expect(t.getState().search.query).toBe('bob')
    expect(ids(t)).toEqual([2])
    t.cancelSearch()
    expect(t.getState().search).toEqual({ input: 'bob', query: 'bob', status: 'idle' })
    t.clearSearch()
    expect(t.getState().search).toEqual({ input: '', query: '', status: 'idle' })
    expect(ids(t)).toEqual([0, 1, 2, 3, 4])
  })

  it('a non-string query at runtime is coerced (null → empty)', async () => {
    const t = make()
    await (t.setSearch as (q: unknown) => Promise<unknown>)(null)
    expect(t.getState().search.query).toBe('')
    await (t.setSearch as (q: unknown) => Promise<unknown>)(40)
    expect(t.getState().search.query).toBe('40')
  })
})

describe('search(): client matching (§6.3)', () => {
  it('a blank or whitespace-only query returns every row, in data order', async () => {
    const t = make()
    expect(ids(t)).toEqual([0, 1, 2, 3, 4])
    await t.setSearch('   ')
    expect(ids(t)).toEqual([0, 1, 2, 3, 4])
    expect(t.getRowModel().filteredCount).toBe(5)
  })

  it('maps results back by index: Row.original is the very data object (identity kept)', async () => {
    const t = make()
    await t.setSearch('ada')
    const rows = t.getRowModel().rows
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r.original).toBe(users[r.index])
  })

  it('identical rows stay distinct (no content-based identity)', async () => {
    const twin = { id: 9, name: 'Zed', city: 'X', age: 1, tags: [] }
    const data = [twin, { ...twin }, twin]
    const t = make({}, data)
    await t.setSearch('zed')
    const rows = t.getRowModel().rows
    expect(rows.map((r) => r.index)).toEqual([0, 1, 2])
    expect(rows[0]?.original).toBe(data[0])
    expect(rows[1]?.original).toBe(data[1])
  })

  it('orders by relevance: score descending, ties by original index', async () => {
    const t = make()
    await t.setSearch('ada')
    // name exact (1.0): 1, 3 · name startsWith (0.8): 0 · city startsWith × 0.5 (0.4): 2
    expect(ids(t)).toEqual([1, 3, 0, 2])
  })

  it('rankHits breaks ties by row index whatever order the matcher returns them in (R6)', () => {
    const hits = [
      { i: 7, score: 0.5 },
      { i: 5, score: 1 },
      { i: 2, score: 1 },
      { i: 3, score: 0.5 },
    ]
    expect(Array.from(rankHits(hits))).toEqual([2, 5, 3, 7])
  })

  it('relevance order is deterministic across runs and data copies', async () => {
    const data = Array.from({ length: 200 }, (_, i) => ({
      id: i,
      name: ['ann', 'anne', 'xann', 'anna'][i % 4] as string,
      city: '',
      age: i,
      tags: [],
    }))
    const t1 = make({}, data)
    const t2 = make({}, [...data])
    await t1.setSearch('ann')
    await t2.setSearch('ann')
    const a = ids(t1)
    expect(a).toEqual(ids(t2))
    // exact (i % 4 === 0) first in index order, then startsWith (1, 3) by index, then contains (2)
    const exact = data.filter((_, i) => i % 4 === 0).map((d) => d.id)
    const starts = data.filter((_, i) => i % 4 === 1 || i % 4 === 3).map((d) => d.id)
    const contains = data.filter((_, i) => i % 4 === 2).map((d) => d.id)
    expect(a).toEqual([...exact, ...starts, ...contains])
  })

  it('matches the formatted value (format; arrays joined)', async () => {
    const t = createTable({
      data: users,
      columns: [
        { key: 'name', search: 1 },
        { key: 'tags', search: 1 },
        { key: 'age', search: 1, format: (v: number) => `${v} years` },
      ],
      features: [search({ threshold: 0.9 })],
    })
    await t.setSearch('blue, green')
    expect(ids(t)).toEqual([1])
    await t.setSearch('52 years')
    expect(ids(t)).toEqual([4])
  })

  it('a numeric column matches its formatted value: NaN as "NaN", null / undefined as empty', async () => {
    const data = [
      { n: 12 },
      { n: Number.NaN },
      { n: null },
      { n: undefined },
      { n: -0 },
      { n: 1.5 },
    ]
    const t = createTable({
      data,
      columns: [{ key: 'n', search: 1 }],
      features: [search({ threshold: 0.9, fuzzyMaxDistance: 0 })],
    })
    const at = () => t.getRowModel().rows.map((r) => r.index)
    await t.setSearch('nan')
    expect(at()).toEqual([1])
    await t.setSearch('null')
    expect(at()).toEqual([])
    await t.setSearch('0')
    expect(at()).toEqual([4])
    await t.setSearch('1.5')
    expect(at()).toEqual([5])
    const clean = createTable({
      data: [{ n: 7 }, { n: 70 }, { n: -0 }],
      columns: [{ key: 'n', search: 1 }],
      features: [search({ threshold: 0.75, fuzzyMaxDistance: 0 })],
    })
    await clean.setSearch('7')
    expect(clean.getRowModel().rows.map((r) => r.index)).toEqual([0, 1])
    await clean.setSearch('0')
    expect(clean.getRowModel().rows.map((r) => r.index)).toEqual([2])
  })

  it('a column of mixed primitives matches what the default formatter shows (#27)', async () => {
    const data = [
      { v: 'abc' },
      { v: 42 },
      { v: true },
      { v: null },
      { v: undefined },
      { v: 10n },
      { v: 'TRUE' },
      { v: false },
    ]
    const t = createTable({
      data,
      features: [search({ threshold: 0.9, fuzzyMaxDistance: 0 })],
    })
    const at = () => t.getRowModel().rows.map((r) => r.index)
    await t.setSearch('true')
    expect(at()).toEqual([2, 6])
    await t.setSearch('42')
    expect(at()).toEqual([1])
    await t.setSearch('10')
    expect(at()).toEqual([5])
    await t.setSearch('false')
    expect(at()).toEqual([7])
    await t.setSearch('null')
    expect(at()).toEqual([])
    await t.setSearch('undefined')
    expect(at()).toEqual([])
  })

  it('matches across chunks of rows like over the whole (case folded per chunk)', async () => {
    // One searchable column: 16,384 rows per chunk (CELLS), so 40k rows are three chunks.
    const data = Array.from({ length: 40_000 }, (_, i) => ({ id: i, name: `Item ${i}` }))
    const t = createTable({
      data,
      columns: [{ key: 'name', search: 1 }, { key: 'id' }],
      features: [search({ threshold: 0.75, fuzzyMaxDistance: 0 })],
    })
    await t.setSearch('ITEM 39999')
    expect(t.getRowModel().rows.map((r) => r.index)).toEqual([39999])
    await t.setSearch('item 500')
    expect(t.getRowModel().rows.map((r) => r.index)).toEqual([
      500, 5000, 5001, 5002, 5003, 5004, 5005, 5006, 5007, 5008, 5009,
    ])
  })

  it('only weighted columns are searched when any column declares a weight', async () => {
    const t = make()
    await t.setSearch('52')
    expect(ids(t)).toEqual([])
  })

  it('no column declares a weight: every column is searchable at weight 1', async () => {
    const t = createTable({
      data: users,
      columns: [{ key: 'name' }, { key: 'age' }],
      features: [search()],
    })
    await t.setSearch('52')
    expect(ids(t)).toEqual([4])
  })

  it('accessor columns are searchable', async () => {
    const t = createTable({
      data: users,
      columns: [{ id: 'label', accessor: (u: U) => `${u.name}@${u.city}`, search: 1 }],
      features: [search()],
    })
    await t.setSearch('cara@bangkok')
    expect(ids(t)).toEqual([4])
  })

  it('threshold, caseSensitive and fuzzyMaxDistance reach the matcher', async () => {
    const strict = make({ threshold: 0.9 })
    await strict.setSearch('ada')
    expect(ids(strict)).toEqual([1, 3])
    const ci = make()
    await ci.setSearch('ADA')
    expect(ids(ci)).toEqual([1, 3, 0, 2])
    const cs = make({ caseSensitive: true })
    await cs.setSearch('ADA')
    expect(ids(cs)).toEqual([])
    const fuzzy = make({ fuzzyMaxDistance: 1 })
    await fuzzy.setSearch('Carx')
    expect(ids(fuzzy)).toEqual([4])
    const noFuzzy = make({ fuzzyMaxDistance: 0 })
    await noFuzzy.setSearch('Carx')
    expect(ids(noFuzzy)).toEqual([])
  })

  it('a typo matches one word of a multi-word cell, and still the whole cell (#10)', async () => {
    const data = [
      { id: 1, name: 'José García' },
      { id: 2, name: 'Garcia Lopez' },
      { id: 3, name: 'Somchai Jaidee' },
      { id: 4, name: 'Mali' },
    ]
    const t = createTable({ data, rowKey: 'id', columns: [{ key: 'name' }], features: [search()] })
    const found: Record<string, number[]> = {}
    for (const q of ['jose', 'lopes', 'somchia', 'Maly', 'garcia lopes', 'jaidee somchai']) {
      await t.setSearch(q)
      found[q] = ids(t)
    }
    expect(found).toEqual({
      jose: [1],
      lopes: [2],
      somchia: [3],
      Maly: [4],
      'garcia lopes': [2],
      'jaidee somchai': [],
    })
    // The edit limit still holds per word: 2 edits from every word (and the cell) is no match at 1.
    const one = createTable({
      data,
      rowKey: 'id',
      columns: [{ key: 'name' }],
      features: [search({ fuzzyMaxDistance: 1 })],
    })
    await one.setSearch('somchia')
    expect(ids(one)).toEqual([])
  })

  it('the query is trimmed before matching', async () => {
    const t = make()
    await t.setSearch('  bob ')
    expect(ids(t)).toEqual([2])
    expect(t.getState().search.input).toBe('  bob ')
  })

  it('NFC and NFD spellings match each other, like the contains filter (#30)', async () => {
    const data = [
      { id: 0, name: 'Zoë' }, // NFC
      { id: 1, name: 'Zoë' }, // NFD
      { id: 2, name: 'Zoe' },
      { id: 3, name: 'กำ' }, // Thai, NFC-stable
    ]
    for (const caseSensitive of [false, true]) {
      const t = createTable({
        data,
        onDiagnostic,
        columns: [{ key: 'name' }],
        features: [search({ caseSensitive, fuzzyMaxDistance: 0 })],
      })
      const zo = caseSensitive ? 'Zo' : 'zo'
      await t.setSearch(`${zo}ë`)
      expect(ids(t), `NFC query, caseSensitive ${caseSensitive}`).toEqual([0, 1])
      await t.setSearch(`${zo}ë`)
      expect(ids(t), `NFD query, caseSensitive ${caseSensitive}`).toEqual([0, 1])
      await t.setSearch('กำ')
      expect(ids(t)).toEqual([3])
    }
  })
})

describe('search(): pipeline (§3.3)', () => {
  it('searches only the rows left by the filter stage', async () => {
    const t = createTable({
      data: users,
      columns: [{ key: 'name', search: 1 }, { key: 'age' }],
      features: [search(), minFilter('age')],
    })
    ;(t as unknown as { setMin(n: number): void }).setMin(20)
    await t.setSearch('ada')
    expect(ids(t)).toEqual([1, 0])
    expect(t.getRowModel().filteredCount).toBe(2)
  })

  it('an active sort wins over relevance', async () => {
    const t = createTable({
      data: users,
      columns: [{ key: 'name', search: 1 }, { key: 'age' }],
      features: [numSort('age'), search()],
    })
    await t.setSearch('ada')
    expect(ids(t)).toEqual([1, 3, 0])
    ;(t as unknown as { setSort(by: 'asc'): void }).setSort('asc')
    expect(ids(t)).toEqual([3, 1, 0])
  })

  it('builds the projection once per data + columns, not per query', async () => {
    const format = vi.fn((v: string) => v)
    const columns = [{ key: 'name' as const, search: 1, format }]
    const t = createTable({ data: users, columns, features: [search()] })
    const built = vi.spyOn(ExSearch.prototype, 'setData')
    await t.setSearch('ada')
    await t.setSearch('bob')
    await t.setSearch('cara')
    expect(format).toHaveBeenCalledTimes(users.length)
    expect(built).toHaveBeenCalledTimes(1)
    const next = users.slice(0, 3)
    t.setOptions({ data: next })
    expect(ids(t)).toEqual([])
    await t.setSearch('ada')
    expect(ids(t)).toEqual([1, 0])
    expect(format).toHaveBeenCalledTimes(users.length + next.length)
  })

  it('does not build the projection while the query is blank', () => {
    const format = vi.fn((v: string) => v)
    const t = createTable({
      data: users,
      columns: [{ key: 'name', search: 1, format }],
      features: [search()],
    })
    t.getRowModel()
    expect(format).not.toHaveBeenCalled()
  })

  it('a slice change that keeps the query does not re-run matching', async () => {
    const t = make()
    await t.setSearch('ada')
    const before = t.getRowModel()
    const run = vi.spyOn(ExSearch.prototype, 'search')
    t.setState({ search: { input: 'adam', query: 'ada', status: 'idle' } })
    const after = t.getRowModel()
    expect(run).not.toHaveBeenCalled()
    expect(after.rows.map((r) => r.index)).toEqual(before.rows.map((r) => r.index))
  })

  it('no searchable column: rows pass through with DK_OPTION_NO_EFFECT (once)', async () => {
    // Every column declares weight 0 (zero-config would now derive searchable columns, T12).
    const t = createTable({
      data: users,
      columns: [{ key: 'name', search: 0 }],
      onDiagnostic,
      features: [search()],
    })
    await t.setSearch('ada')
    expect(ids(t)).toEqual([0, 1, 2, 3, 4])
    await t.setSearch('bob')
    t.getRowModel()
    expect(codes()).toEqual(['DK_OPTION_NO_EFFECT'])
    expect(seen[0]?.details).toMatchObject({ feature: 'search', path: 'query' })
    expect(seen[0]?.fix.length).toBeGreaterThan(0)
  })
})

describe('search(): options (§3.5)', () => {
  it('rejects an out-of-range threshold as DK_INVALID_OPTION', () => {
    expect(() => make({ threshold: 2 })).toThrow(/DK_INVALID_OPTION|threshold/)
  })

  it('reports an unknown option', () => {
    make({ treshold: 0.5 } as never)
    expect(codes()).toContain('DK_UNKNOWN_OPTION')
  })
})
