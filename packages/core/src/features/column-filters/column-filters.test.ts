import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from '../../diagnostics/types'
import { createTable } from '../../table/create-table'
import { columnFilters } from './index'

let seen: Diagnostic[]
const onDiagnostic = (d: Diagnostic) => {
  seen.push(d)
}
const codes = () => seen.map((d) => d.code)

beforeEach(() => {
  seen = []
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

type R = {
  id: number
  name: string | null
  age: number | null | undefined
  big: bigint
  on: boolean
  at: Date | null
  tags: string[] | null
  nums: number[]
  any: unknown
}

const D = (s: string) => new Date(`${s}T00:00:00Z`)
const rows: R[] = [
  {
    id: 0,
    name: 'Ada',
    age: 36,
    big: 10n,
    on: true,
    at: D('2020-01-01'),
    tags: ['vip', 'x'],
    nums: [1, 5],
    any: 1,
  },
  { id: 1, name: 'bob', age: null, big: 20n, on: false, at: null, tags: [], nums: [], any: '1' },
  {
    id: 2,
    name: null,
    age: 17,
    big: 30n,
    on: true,
    at: D('2021-06-15'),
    tags: null,
    nums: [9],
    any: null,
  },
  {
    id: 3,
    name: 'Adam',
    age: undefined,
    big: 40n,
    on: false,
    at: D('2022-12-31'),
    tags: ['X'],
    nums: [2, 3],
    any: true,
  },
  {
    id: 4,
    name: 'ซู่',
    age: 50,
    big: 50n,
    on: true,
    at: D('2019-05-05'),
    tags: ['ไทย'],
    nums: [7],
    any: 'ADA',
  },
]
const COLUMNS = (['name', 'age', 'big', 'on', 'at', 'tags', 'nums', 'any'] as const).map((key) => ({
  key,
}))

// Filters are passed untyped here: the matrix includes runtime-wrong values on purpose.
type Api = {
  setColumnFilter(id: string, f: unknown): void
  resetColumnFilters(): void
  getState(): { columnFilters: Record<string, unknown> }
  getRowModel(): { rows: readonly { original: R }[]; filteredCount: number; status: string }
}

function table(data: readonly R[] = rows, init?: Record<string, unknown>) {
  return createTable({
    data,
    columns: COLUMNS,
    features: [columnFilters()],
    onDiagnostic,
    ...(init ? { initialState: { columnFilters: init } } : {}),
  }) as unknown as Api
}

const ids = (t: Api) => t.getRowModel().rows.map((r) => r.original.id)
const filtered = (id: string, f: unknown, data?: readonly R[]) => {
  const t = table(data)
  t.setColumnFilter(id, f)
  return ids(t)
}

describe('columnFilters: state and API', () => {
  it('starts empty; no filter keeps every row in order', () => {
    const t = table()
    expect(t.getState().columnFilters).toEqual({})
    expect(ids(t)).toEqual([0, 1, 2, 3, 4])
  })

  it('setColumnFilter sets / clears one column; resetColumnFilters clears all', () => {
    const t = table()
    t.setColumnFilter('on', { type: 'equals', value: true })
    t.setColumnFilter('age', { type: 'range', value: { min: 18 } })
    expect(Object.keys(t.getState().columnFilters).sort()).toEqual(['age', 'on'])
    expect(ids(t)).toEqual([0, 4])
    t.setColumnFilter('age', undefined)
    expect(Object.keys(t.getState().columnFilters)).toEqual(['on'])
    expect(ids(t)).toEqual([0, 2, 4])
    t.resetColumnFilters()
    expect(t.getState().columnFilters).toEqual({})
    expect(ids(t)).toEqual([0, 1, 2, 3, 4])
  })

  it('initialState.columnFilters applies at creation', () => {
    const t = table(rows, { name: { type: 'contains', value: 'ad' } })
    expect(ids(t)).toEqual([0, 3])
    expect(t.getRowModel().filteredCount).toBe(2)
  })

  it('multiple column filters combine with AND', () => {
    const t = table()
    t.setColumnFilter('name', { type: 'contains', value: 'a' })
    t.setColumnFilter('on', { type: 'equals', value: false })
    expect(ids(t)).toEqual([3])
  })

  it('undefined, null and "" values are inactive (as are empty in-lists and empty ranges)', () => {
    for (const f of [
      { type: 'contains', value: '' },
      { type: 'contains', value: undefined },
      { type: 'equals', value: '' },
      { type: 'equals', value: null },
      { type: 'in', value: [] },
      { type: 'in', value: undefined },
      { type: 'range', value: {} },
      { type: 'range', value: { min: undefined, max: '' } },
      undefined,
    ]) {
      expect(filtered('name', f), JSON.stringify(f)).toEqual([0, 1, 2, 3, 4])
    }
    expect(codes()).toEqual([])
  })

  it('the step is memoised: same state → same row model; inactive filters keep the input', () => {
    const t = table()
    t.setColumnFilter('name', { type: 'contains', value: '' })
    const a = t.getRowModel()
    expect(t.getRowModel()).toBe(a)
    expect(a.filteredCount).toBe(5)
  })
})

describe('columnFilters: operator matrix', () => {
  it('equals: strict equality per type', () => {
    expect(filtered('name', { type: 'equals', value: 'Ada' })).toEqual([0])
    expect(filtered('name', { type: 'equals', value: 'ada' })).toEqual([])
    expect(filtered('age', { type: 'equals', value: 17 })).toEqual([2])
    expect(filtered('big', { type: 'equals', value: 30n })).toEqual([2])
    expect(filtered('on', { type: 'equals', value: false })).toEqual([1, 3])
    // Dates compare by time value.
    expect(filtered('at', { type: 'equals', value: D('2021-06-15') })).toEqual([2])
    expect(codes()).toEqual([])
  })

  it('contains: case-insensitive substring', () => {
    expect(filtered('name', { type: 'contains', value: 'AD' })).toEqual([0, 3])
    expect(filtered('name', { type: 'contains', value: 'zz' })).toEqual([])
    expect(codes()).toEqual([])
  })

  it('contains: NFC-normalised (Thai combining-mark order, decomposed Latin)', () => {
    // ซู่ stored as ซ + sara uu + mai ek; typed with the marks in the other order.
    const typed = 'ซู่'
    expect(typed).not.toBe('ซู่')
    expect(filtered('name', { type: 'contains', value: typed })).toEqual([4])
    const cafe: R[] = [{ ...(rows[0] as R), id: 9, name: 'Café Noir' }]
    expect(filtered('name', { type: 'contains', value: 'CAFÉ' }, cafe)).toEqual([9])
  })

  it('in: set membership per type', () => {
    expect(filtered('name', { type: 'in', value: ['bob', 'Adam', 'nobody'] })).toEqual([1, 3])
    expect(filtered('age', { type: 'in', value: [17, 50] })).toEqual([2, 4])
    expect(filtered('big', { type: 'in', value: [10n, 50n] })).toEqual([0, 4])
    expect(filtered('on', { type: 'in', value: [true] })).toEqual([0, 2, 4])
    expect(filtered('at', { type: 'in', value: [D('2019-05-05'), D('2020-01-01')] })).toEqual([
      0, 4,
    ])
    expect(codes()).toEqual([])
  })

  it('range: inclusive bounds on number, bigint and Date; one bound is enough', () => {
    expect(filtered('age', { type: 'range', value: { min: 17, max: 36 } })).toEqual([0, 2])
    expect(filtered('age', { type: 'range', value: { min: 36 } })).toEqual([0, 4])
    expect(filtered('age', { type: 'range', value: { max: 17 } })).toEqual([2])
    expect(filtered('big', { type: 'range', value: { min: 20n, max: 40n } })).toEqual([1, 2, 3])
    expect(filtered('big', { type: 'range', value: { min: 25 } })).toEqual([2, 3, 4])
    expect(
      filtered('at', { type: 'range', value: { min: D('2020-01-01'), max: D('2021-06-15') } }),
    ).toEqual([0, 2])
    expect(filtered('age', { type: 'range', value: { min: 40, max: 20 } })).toEqual([])
    expect(codes()).toEqual([])
  })

  it('custom: fn(value, filterValue, row); nullish cells never reach fn', () => {
    const fn = vi.fn((v: number, fv: number, row: R) => v % fv === 0 && row.on)
    expect(filtered('age', { type: 'custom', value: 2, fn })).toEqual([0, 4])
    expect(fn).toHaveBeenCalledTimes(3)
    expect(fn).toHaveBeenCalledWith(36, 2, rows[0])
    // Custom gets the whole cell value, arrays included; it is active without a value.
    expect(filtered('nums', { type: 'custom', fn: (v: number[]) => v.length > 1 })).toEqual([0, 3])
  })

  it('custom fn that throws: row non-matching, one DK_CALLBACK_FAILED per column', () => {
    const fn = (v: string) => {
      if (v.startsWith('A')) throw new TypeError('boom')
      return true
    }
    expect(filtered('name', { type: 'custom', fn })).toEqual([1, 4])
    expect(codes()).toEqual(['DK_CALLBACK_FAILED'])
    const d = seen[0] as Diagnostic
    expect(d.where).toEqual({ kind: 'option', path: 'state.columnFilters.name.fn' })
    expect(d.details).toMatchObject({
      column: 'name',
      count: 2,
      rows: [0, 3],
      errorName: 'TypeError',
    })
    expect(d.context.cause).toBeInstanceOf(TypeError)
  })

  it('a custom filter without a function is a type mismatch on the filter', () => {
    expect(filtered('name', { type: 'custom', value: 1 })).toEqual([])
    expect(codes()).toEqual(['DK_FILTER_TYPE_MISMATCH'])
  })
})

describe('columnFilters: null, arrays, unknown columns', () => {
  it('null / undefined cells match no active filter (and are no mismatch)', () => {
    expect(filtered('age', { type: 'range', value: { min: 0 } })).toEqual([0, 2, 4])
    expect(filtered('name', { type: 'contains', value: 'a' })).toEqual([0, 3])
    expect(filtered('at', { type: 'range', value: { min: D('1900-01-01') } })).toEqual([0, 2, 3, 4])
    expect(filtered('tags', { type: 'contains', value: '' })).toEqual([0, 1, 2, 3, 4])
    expect(codes()).toEqual([])
  })

  it('array cells match if any element matches; empty arrays match nothing', () => {
    expect(filtered('tags', { type: 'contains', value: 'x' })).toEqual([0, 3])
    expect(filtered('tags', { type: 'equals', value: 'vip' })).toEqual([0])
    expect(filtered('tags', { type: 'in', value: ['X', 'ไทย'] })).toEqual([3, 4])
    expect(filtered('nums', { type: 'range', value: { min: 6 } })).toEqual([2, 4])
    expect(filtered('nums', { type: 'equals', value: 3 })).toEqual([3])
    expect(codes()).toEqual([])
  })

  it('a filter on a column id that is not in columns is ignored', () => {
    expect(filtered('nope', { type: 'equals', value: 1 })).toEqual([0, 1, 2, 3, 4])
  })

  it('works on accessor columns', () => {
    const t = createTable({
      data: rows,
      columns: [{ id: 'twice', accessor: (r: R) => r.id * 2 }],
      features: [columnFilters()],
    }) as unknown as Api
    t.setColumnFilter('twice', { type: 'range', value: { min: 4 } })
    expect(ids(t)).toEqual([2, 3, 4])
  })
})

describe('columnFilters: DK_FILTER_TYPE_MISMATCH', () => {
  it('wrong cell type: non-match + one warn per column per run with counts and samples', () => {
    // `any` holds 1, '1', null, true, 'ADA': contains only accepts strings.
    expect(filtered('any', { type: 'contains', value: '1' })).toEqual([1])
    expect(codes()).toEqual(['DK_FILTER_TYPE_MISMATCH'])
    const d = seen[0] as Diagnostic
    expect(d.level).toBe('warn')
    expect(d.where).toEqual({ kind: 'column', index: 7, id: 'any' })
    expect(d.details).toMatchObject({
      column: 'any',
      filter: 'contains',
      source: 'cell',
      expected: 'string',
      received: 'number',
      count: 2,
      rows: [0, 3],
    })
    expect(d.problem).toMatch(/any/)
    expect(d.fix.length).toBeGreaterThan(0)
  })

  it('equals: number filter value on a string-typed cell is a mismatch (suggests coercion)', () => {
    expect(filtered('any', { type: 'equals', value: 1 })).toEqual([0])
    const d = seen[0] as Diagnostic
    expect(d.details).toMatchObject({ expected: 'number', received: 'string', count: 3 })
    expect(d.fix.join('\n')).toMatch(/Number\(|String\(/)
  })

  it('numeric column (Float64Array) with a string filter value: every non-null cell mismatches', () => {
    expect(filtered('age', { type: 'equals', value: '36' })).toEqual([])
    expect(seen[0]?.details).toMatchObject({ received: 'number', count: 3, rows: [0, 2, 4] })
    seen = []
    expect(filtered('age', { type: 'contains', value: '3' })).toEqual([])
    expect(codes()).toEqual(['DK_FILTER_TYPE_MISMATCH'])
  })

  it('range: cells of another family mismatch; Date bounds vs numbers', () => {
    expect(filtered('name', { type: 'range', value: { min: 1 } })).toEqual([])
    expect(seen[0]?.details).toMatchObject({ filter: 'range', received: 'string', count: 4 })
    seen = []
    expect(filtered('age', { type: 'range', value: { min: D('2000-01-01') } })).toEqual([])
    expect(seen[0]?.details).toMatchObject({ expected: 'Date', received: 'number' })
  })

  it('in: cells whose type is not in the list mismatch', () => {
    expect(filtered('any', { type: 'in', value: ['1', 'ADA'] })).toEqual([1, 4])
    expect(seen[0]?.details).toMatchObject({ count: 2, rows: [0, 3] })
  })

  it('a malformed filter value is reported once (source: filter) and matches nothing', () => {
    expect(filtered('name', { type: 'contains', value: 5 })).toEqual([])
    expect(seen[0]?.details).toMatchObject({
      source: 'filter',
      filter: 'contains',
      received: 'number',
    })
    seen = []
    expect(filtered('name', { type: 'range', value: 5 })).toEqual([])
    expect(seen[0]?.details).toMatchObject({ source: 'filter', filter: 'range' })
    seen = []
    expect(filtered('name', { type: 'in', value: 'Ada' })).toEqual([])
    expect(seen[0]?.details).toMatchObject({ source: 'filter', filter: 'in' })
    seen = []
    expect(filtered('name', { type: 'between', value: 1 })).toEqual([])
    expect(seen[0]?.details).toMatchObject({ source: 'filter', filter: 'between' })
    expect(seen[0]?.fix.join('\n')).toMatch(/equals|contains|in|range|custom/)
  })

  it('details carry types only, never row values', () => {
    filtered('any', { type: 'contains', value: 'secret-needle' })
    expect(JSON.stringify(seen[0]?.toJSON())).not.toMatch(/secret-needle|ADA/)
  })
})
