import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from '../../diagnostics/types'
import { createTable } from '../../table/create-table'
import { columnFilters } from './index'

let seen: Diagnostic[]
const onDiagnostic = (d: Diagnostic) => {
  seen.push(d)
}

beforeEach(() => {
  seen = []
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

type R = { id: number; age: number }
const rows: R[] = [
  { id: 0, age: 36 },
  { id: 1, age: 17 },
  { id: 2, age: 52 },
]

const filtered = (id: keyof R, filter: unknown) => {
  const t = createTable({
    data: rows,
    rowKey: 'id',
    onDiagnostic,
    columns: [{ key: 'id' }, { key: 'age' }],
    features: [columnFilters()],
  })
  t.setColumnFilter(id, filter as never)
  return t.getRowModel().rows.map((r) => r.original.id)
}

const mismatch = () => seen.filter((d) => d.code === 'DK_FILTER_TYPE_MISMATCH')

describe('#91: a NaN filter value is reported, never silent', () => {
  it.each([
    ['min', { min: Number.NaN }],
    ['max', { max: Number.NaN }],
    ['min with a valid max', { min: Number.NaN, max: 40 }],
  ])('a NaN range bound (%s) is a malformed range-bound (source: filter)', (_, value) => {
    expect(filtered('age', { type: 'range', value })).toEqual([])
    expect(mismatch()).toHaveLength(1)
    expect(mismatch()[0]?.details).toMatchObject({
      source: 'filter',
      filter: 'range',
      received: 'number(NaN)',
      count: 0,
    })
    expect(mismatch()[0]?.details.expected).toMatch(/bound/)
  })

  it('equals(NaN) is a malformed filter value too (NaN equals no cell)', () => {
    expect(filtered('age', { type: 'equals', value: Number.NaN })).toEqual([])
    expect(mismatch()).toHaveLength(1)
    expect(mismatch()[0]?.details).toMatchObject({
      source: 'filter',
      filter: 'equals',
      received: 'number(NaN)',
    })
    expect(mismatch()[0]?.details.expected).toMatch(/NaN/)
  })

  it('valid numeric bounds and equals still filter normally, with no diagnostic', () => {
    expect(filtered('age', { type: 'range', value: { min: 18 } })).toEqual([0, 2])
    expect(filtered('age', { type: 'equals', value: 17 })).toEqual([1])
    expect(mismatch()).toEqual([])
  })
})
