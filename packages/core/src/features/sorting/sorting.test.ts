import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from '../../diagnostics/types'
import { createTable } from '../../table/create-table'
import { compareValues } from './compare'
import { sorting } from './sorting'

let seen: Diagnostic[]
const onDiagnostic = (d: Diagnostic) => {
  seen.push(d)
}

beforeEach(() => {
  seen = []
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

type P = { id: number; name: string; age: number | null; at?: Date; v?: unknown }

const people: P[] = [
  { id: 0, name: 'b', age: 30 },
  { id: 1, name: 'a', age: null },
  { id: 2, name: 'c', age: 20 },
  { id: 3, name: 'a', age: 30 },
  { id: 4, name: 'B', age: Number.NaN },
  { id: 5, name: 'c', age: 10 },
]

const ids = (t: { getRowModel(): { rows: readonly { original: unknown }[] } }) =>
  t.getRowModel().rows.map((r) => (r.original as P).id)

const make = (
  data: P[] = people,
  columns: readonly unknown[] = [{ key: 'name' }, { key: 'age' }],
) =>
  createTable({
    data,
    columns: columns as never,
    features: [sorting()],
    onDiagnostic,
  })

describe('sorting — state and toggleSort', () => {
  it('starts unsorted and keeps the input order', () => {
    const t = make()
    expect(t.getState().sorting).toEqual({ by: [] })
    expect(ids(t)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('cycles asc → desc → none on one column', () => {
    const t = make()
    t.toggleSort('age')
    expect(t.getState().sorting.by).toEqual([{ id: 'age', desc: false }])
    expect(t.getSortDirection('age')).toBe('asc')
    t.toggleSort('age')
    expect(t.getState().sorting.by).toEqual([{ id: 'age', desc: true }])
    expect(t.getSortDirection('age')).toBe('desc')
    t.toggleSort('age')
    expect(t.getState().sorting.by).toEqual([])
    expect(t.getSortDirection('age')).toBe(false)
  })

  it('without multi, toggling another column replaces the sort', () => {
    const t = make()
    t.toggleSort('age')
    t.toggleSort('name')
    expect(t.getState().sorting.by).toEqual([{ id: 'name', desc: false }])
  })

  it('without multi, a column already in a multi sort continues its own cycle alone', () => {
    const t = make()
    t.setSorting([
      { id: 'name', desc: false },
      { id: 'age', desc: false },
    ])
    t.toggleSort('age')
    expect(t.getState().sorting.by).toEqual([{ id: 'age', desc: true }])
  })

  it('multi appends, cycles in place and removes', () => {
    const t = make()
    t.toggleSort('name')
    t.toggleSort('age', { multi: true })
    expect(t.getState().sorting.by).toEqual([
      { id: 'name', desc: false },
      { id: 'age', desc: false },
    ])
    t.toggleSort('name', { multi: true })
    expect(t.getState().sorting.by).toEqual([
      { id: 'name', desc: true },
      { id: 'age', desc: false },
    ])
    t.toggleSort('name', { multi: true })
    expect(t.getState().sorting.by).toEqual([{ id: 'age', desc: false }])
  })

  it('setSorting / clearSorting replace the whole sort', () => {
    const t = make()
    t.setSorting([{ id: 'age', desc: true }])
    expect(t.getSortDirection('age')).toBe('desc')
    t.clearSorting()
    expect(t.getState().sorting.by).toEqual([])
  })

  it('initialState.sorting is honoured', () => {
    const t = createTable({
      data: people,
      columns: [{ key: 'age' }],
      features: [sorting()],
      initialState: { sorting: { by: [{ id: 'age', desc: false }] } },
    })
    expect(ids(t)).toEqual([5, 2, 0, 3, 1, 4])
  })
})

describe('sorting — comparator', () => {
  it('numbers asc: nulls and NaN last, ties keep input order (stable)', () => {
    const t = make()
    t.toggleSort('age')
    expect(ids(t)).toEqual([5, 2, 0, 3, 1, 4])
  })

  it('numbers desc: nulls and NaN still last, ties keep input order', () => {
    const t = make()
    t.setSorting([{ id: 'age', desc: true }])
    expect(ids(t)).toEqual([0, 3, 2, 5, 1, 4])
  })

  it('strings use the collator (case-insensitive base order, numeric) and stay stable', () => {
    const t = make()
    t.toggleSort('name')
    // a(1), a(3), b(0), B(4), c(2), c(5): equal-collating names keep input order
    expect(ids(t).map((i) => people[i]?.name)).toEqual(['a', 'a', 'b', 'B', 'c', 'c'])
    expect(ids(t).slice(0, 2)).toEqual([1, 3])
    expect(ids(t).slice(4)).toEqual([2, 5])
    const files = ['file10', 'file2', 'file1'].map((name, id) => ({ id, name, age: 0 }))
    const f = make(files, [{ key: 'name' }])
    f.toggleSort('name')
    expect(ids(f).map((i) => files[i]?.name)).toEqual(['file1', 'file2', 'file10'])
  })

  it('multi-column: later entries break ties of earlier ones', () => {
    const t = make()
    t.setSorting([
      { id: 'name', desc: false },
      { id: 'age', desc: true },
    ])
    expect(ids(t)).toEqual([3, 1, 0, 4, 2, 5])
  })

  it('Dates sort by time; invalid Dates sort last in both directions', () => {
    const d = (s: string) => new Date(s)
    const data: P[] = [
      { id: 0, name: '', age: 0, at: d('2024-03-01') },
      { id: 1, name: '', age: 0, at: d('nope') },
      { id: 2, name: '', age: 0, at: d('2024-01-01') },
      { id: 3, name: '', age: 0 },
      { id: 4, name: '', age: 0, at: d('2024-02-01') },
    ]
    const t = make(data, [{ key: 'at' }])
    t.toggleSort('at')
    expect(ids(t)).toEqual([2, 4, 0, 1, 3])
    t.toggleSort('at')
    expect(ids(t)).toEqual([0, 4, 2, 1, 3])
  })

  it('mixed types order by type rank, nulls last', () => {
    const data: P[] = ['x', 2, null, true, 1n, new Date(0), undefined, 1].map((v, id) => ({
      id,
      name: '',
      age: 0,
      v,
    }))
    const t = make(data, [{ key: 'v' }])
    t.toggleSort('v')
    // numbers / bigints → Date → string → boolean → nullish
    expect(ids(t)).toEqual([4, 7, 1, 5, 0, 3, 2, 6])
    t.toggleSort('v')
    expect(ids(t)).toEqual([3, 0, 5, 1, 4, 7, 2, 6])
  })

  it('compareValues is exported and puts missing values last', () => {
    const c = new Intl.Collator(undefined, { numeric: true })
    expect(compareValues(1, 2, c)).toBeLessThan(0)
    expect(compareValues(null, 2, c)).toBeGreaterThan(0)
    expect(compareValues(2, Number.NaN, c)).toBeLessThan(0)
    expect(compareValues(undefined, null, c)).toBe(0)
  })

  it('an id that is not a column sorts by its path', () => {
    const t = make(people, [{ key: 'name' }])
    t.toggleSort('age')
    expect(ids(t)).toEqual([5, 2, 0, 3, 1, 4])
  })

  it('a derived (accessor) column sorts by its id', () => {
    const t = make(people, [{ id: 'neg', accessor: (p: P) => -(p.age ?? 0) }])
    t.setSorting([{ id: 'neg' as never, desc: false }])
    expect(ids(t)).toEqual([0, 3, 2, 5, 1, 4])
  })

  it('locale option feeds the collator', () => {
    const data = ['z', 'ä', 'a'].map((name, id) => ({ id, name, age: 0 }))
    const t = createTable({
      data,
      columns: [{ key: 'name' }],
      features: [sorting({ locale: 'sv' })],
    })
    t.toggleSort('name')
    // Swedish: ä after z
    expect(t.getRowModel().rows.map((r) => r.original.name)).toEqual(['a', 'z', 'ä'])
  })

  it('the default collation does not follow the runtime locale (SSR = hydration, #12)', () => {
    // Simulates a browser whose default locale is sv-SE while the server's was en-US.
    const Real = Intl.Collator
    class SvCollator extends Real {
      constructor(l?: string | string[], o?: Intl.CollatorOptions) {
        super(l ?? 'sv-SE', o)
      }
    }
    const spy = vi.spyOn(Intl, 'Collator').mockImplementation(SvCollator as never)
    try {
      const names = ['Zoë', 'Ångström', 'Bjørn', 'Øst', 'Ärla', 'Adam']
      const t = createTable({
        data: names.map((name, id) => ({ id, name })),
        columns: [{ key: 'name' }],
        features: [sorting()],
      })
      t.toggleSort('name')
      expect(t.getRowModel().rows.map((r) => r.original.name)).toEqual([
        'Adam',
        'Ångström',
        'Ärla',
        'Bjørn',
        'Øst',
        'Zoë',
      ])
    } finally {
      spy.mockRestore()
    }
  })

  it('an invalid locale is a config error', () => {
    expect(() => createTable({ data: people, features: [sorting({ locale: '!!' })] })).toThrow(
      /DK_INVALID_OPTION/,
    )
  })
})

describe('sorting — overrides', () => {
  it('sortBy keys the column and is called once per row per data', () => {
    const sortBy = vi.fn((p: P) => p.name.toLowerCase())
    const t = make(people, [{ key: 'id', sortBy }])
    t.toggleSort('id')
    expect(ids(t)).toEqual([1, 3, 0, 4, 2, 5])
    t.toggleSort('id')
    expect(ids(t)).toEqual([2, 5, 0, 4, 1, 3])
    expect(sortBy).toHaveBeenCalledTimes(people.length)
  })

  it('sortFn compares the column values; missing values stay last', () => {
    const data: P[] = [3, null, 1, 2].map((age, id) => ({ id, name: '', age }))
    const sortFn = (a: number, b: number) => (a % 2) - (b % 2) || a - b
    const t = make(data, [{ key: 'age', sortFn }])
    t.toggleSort('age')
    expect(ids(t)).toEqual([3, 2, 0, 1])
    t.toggleSort('age')
    expect(ids(t)).toEqual([0, 2, 3, 1])
  })

  it('a throwing sortFn reports DK_CALLBACK_FAILED and falls back to the default comparator', () => {
    const t = make(people, [
      {
        key: 'age',
        sortFn: () => {
          throw new TypeError('boom')
        },
      },
    ])
    t.toggleSort('age')
    expect(ids(t)).toEqual([5, 2, 0, 3, 1, 4])
    const d = seen.find((x) => x.code === 'DK_CALLBACK_FAILED')
    expect(d?.where).toEqual({ kind: 'option', path: 'columns[0].sortFn' })
  })

  it('a throwing sortBy reports DK_CALLBACK_FAILED; failed rows sort last', () => {
    const t = make(people, [
      {
        key: 'id',
        sortBy: (p: P) => {
          if (p.id === 2) throw new Error('nope')
          return p.id
        },
      },
    ])
    t.setSorting([{ id: 'id', desc: true }])
    expect(ids(t)).toEqual([5, 4, 3, 1, 0, 2])
    const d = seen.find((x) => x.code === 'DK_CALLBACK_FAILED')
    expect(d?.where).toEqual({ kind: 'option', path: 'columns[0].sortBy' })
    expect(d?.details.rows).toEqual([2])
  })
})

describe('sorting — purity', () => {
  it('never mutates the data or the input indices, and memoises on state', () => {
    const data = people.slice()
    const t = make(data)
    t.toggleSort('age')
    const first = t.getRowModel()
    expect(data).toEqual(people)
    expect(t.getRowModel()).toBe(first)
    t.clearSorting()
    expect(ids(t)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('handles empty data', () => {
    const t = make([])
    t.toggleSort('age')
    expect(t.getRowModel().rows).toEqual([])
  })
})
