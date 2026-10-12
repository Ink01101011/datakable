import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from '../diagnostics/types'
import { createTable } from './create-table'
import { dataPrint, diffPrint } from './data-mutation'

/** DK_DATA_MUTATED (§5.3, dev): the same `data` array passed again with changed contents. */

let seen: Diagnostic[]
const onDiagnostic = (d: Diagnostic) => {
  seen.push(d)
}
const codes = () => seen.map((d) => d.code)
const only = (code: string) => {
  const d = seen.filter((x) => x.code === code)
  expect(d).toHaveLength(1)
  return d[0] as Diagnostic
}

beforeEach(() => {
  seen = []
  for (const m of ['error', 'warn', 'info', 'log', 'groupCollapsed', 'group', 'groupEnd'] as const)
    vi.spyOn(console, m).mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

type P = { id: string; name: string }
const people = (n: number): P[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `n${i}` }))

describe('DK_DATA_MUTATED', () => {
  it('push then setOptions({ data }) with the same array: warn with both lengths', () => {
    const data = people(3)
    const t = createTable({ data, onDiagnostic })
    expect(t.getRowModel().totalCount).toBe(3)
    data.push({ id: 'p3', name: 'n3' })
    t.setOptions({ data })
    const d = only('DK_DATA_MUTATED')
    expect(d.level).toBe('warn')
    expect(d.where).toEqual({ kind: 'option', path: 'data' })
    expect(d.details).toMatchObject({ previousLength: 3, length: 4 })
    expect(d.problem).toMatch(/3 → 4/)
    expect(d.impact).toMatch(/still shows/)
    expect(d.fix[0]).toMatch(/new array/)
    expect(d.context.trigger).toBe('setOptions')
    // Spec fallback: nothing re-read, the developer is told to pass a new array.
    expect(t.getRowModel().totalCount).toBe(3)
  })

  it('a row replaced in place is detected (row index in the details)', () => {
    const data = people(4)
    const t = createTable({ data, onDiagnostic })
    data[2] = { id: 'x', name: 'x' }
    t.setOptions({ data })
    expect(only('DK_DATA_MUTATED').details).toMatchObject({ length: 4, rows: [2] })
  })

  it('a field of a row changed in place is detected', () => {
    const data = people(4)
    const t = createTable({ data, onDiagnostic })
    ;(data[1] as P).name = 'changed'
    t.setOptions({ data })
    expect(only('DK_DATA_MUTATED').details).toMatchObject({ rows: [1] })
  })

  it('the same unchanged array, or a new array, reports nothing', () => {
    const data = people(4)
    const t = createTable({ data, onDiagnostic })
    t.setOptions({ data })
    t.setOptions({ data: [...data, { id: 'p4', name: 'n4' }] })
    t.setOptions({ columns: [{ key: 'id' }] })
    expect(codes()).toEqual([])
    expect(t.getRowModel().totalCount).toBe(5)
  })

  it('each further change is one more occurrence; passing it unchanged again is not', () => {
    const data = people(2)
    const t = createTable({ data, onDiagnostic })
    data.push({ id: 'p2', name: 'n2' })
    t.setOptions({ data })
    t.setOptions({ data })
    data.push({ id: 'p3', name: 'n3' })
    t.setOptions({ data })
    // Deduped per code + where per data reference (§8.2): aggregated into the first report.
    expect(only('DK_DATA_MUTATED').context.occurrences.count).toBe(2)
  })

  it('never carries row values', () => {
    const data = [{ id: 'a', email: 'alice@example.com' }]
    const t = createTable({ data, onDiagnostic })
    ;(data[0] as { email: string }).email = 'bob@example.com'
    t.setOptions({ data })
    const d = only('DK_DATA_MUTATED')
    expect(JSON.stringify(d)).not.toMatch(/alice|bob/)
  })
})

describe('dataPrint', () => {
  it('is bounded: samples at most 16 rows and 64 keys per row', () => {
    const data = people(10_000)
    const p = dataPrint(data)
    expect(p.rows.length).toBeLessThanOrEqual(16)
    ;(data[1] as P).name = 'x' // not on the sampled stride
    expect(diffPrint(p, data)).toEqual([])
    ;(data[0] as P).name = 'x' // row 0 is always sampled
    expect(diffPrint(p, data)).toEqual([0])
  })

  it('handles non-object rows and a length change', () => {
    const data: unknown[] = [1, 'a', null, undefined]
    const p = dataPrint(data)
    expect(diffPrint(p, data)).toEqual([])
    data[1] = 'b'
    expect(diffPrint(p, data)).toEqual([1])
    data.pop()
    expect(diffPrint(p, data)).toBe('length')
  })
})
