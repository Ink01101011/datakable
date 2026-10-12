import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from '../../diagnostics/types'
import { makeSchema, userSchema } from '../../ingest/test-schemas'
import { createTable } from '../../table/create-table'
import { columnFilters } from '../column-filters'
import { validity } from './index'

let seen: Diagnostic[]
const onDiagnostic = (d: Diagnostic) => {
  seen.push(d)
}
const codes = () => seen.map((d) => d.code)
const find = (code: string) => seen.find((d) => d.code === code)

beforeEach(() => {
  seen = []
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

const raw: unknown[] = [
  { id: 1, name: 'Ada', age: 36 },
  { id: 2, name: 'Bob', age: 'x' },
  { id: 3, name: 'Cy', age: '41' },
  { id: 4, name: 7, age: 9 },
]
const columns = [{ key: 'name' }, { key: 'age' }] as const
const ids = (t: { getRowModel(): { rows: readonly { index: number }[] } }) =>
  t.getRowModel().rows.map((r) => r.index)

const flagTable = (extra: Record<string, unknown> = {}) =>
  createTable({
    schema: userSchema,
    data: raw,
    columns,
    invalidRows: 'flag',
    features: [validity()],
    onDiagnostic,
    ...extra,
  })

describe("validity() under invalidRows: 'flag'", () => {
  it("defaults to 'all': every row, valid and flagged", () => {
    const t = flagTable()
    expect(t.getState().validity).toBe('all')
    expect(ids(t)).toEqual([0, 1, 2, 3])
  })

  it("'valid' keeps the rows that passed the schema, 'invalid' the flagged ones", () => {
    const t = flagTable()
    t.setValidity('valid')
    expect(t.getState().validity).toBe('valid')
    expect(ids(t)).toEqual([0, 2])
    expect(t.getRowModel().rows.every((r) => r.valid)).toBe(true)
    t.setValidity('invalid')
    expect(ids(t)).toEqual([1, 3])
    expect(t.getRowModel().rows.every((r) => !r.valid)).toBe(true)
    expect(t.getRowModel().filteredCount).toBe(2)
    expect(t.getRowModel().totalCount).toBe(4)
    t.setValidity('all')
    expect(ids(t)).toEqual([0, 1, 2, 3])
    expect(codes()).not.toContain('DK_OPTION_NO_EFFECT')
  })

  it('reads initialState and setState like any slice', () => {
    const t = flagTable({ initialState: { validity: 'invalid' } })
    expect(ids(t)).toEqual([1, 3])
    t.setState((s) => ({ ...s, validity: 'valid' }))
    expect(ids(t)).toEqual([0, 2])
  })

  it('composes with columnFilters (AND), in either listed order', () => {
    for (const features of [
      [columnFilters(), validity()],
      [validity(), columnFilters()],
    ] as const) {
      const t = createTable({
        schema: userSchema,
        data: raw,
        columns,
        invalidRows: 'flag',
        features,
        onDiagnostic,
      })
      t.setColumnFilter('name', { type: 'contains', value: 'b' })
      expect(ids(t)).toEqual([1])
      t.setValidity('valid')
      expect(ids(t)).toEqual([])
      t.setValidity('invalid')
      expect(ids(t)).toEqual([1])
    }
  })

  it('follows new data (the flagged set belongs to the data reference)', () => {
    const t = flagTable({ initialState: { validity: 'invalid' } })
    t.setOptions({
      data: [
        { id: 9, name: 'Z', age: 'bad' },
        { id: 8, name: 'Y', age: 1 },
      ],
    })
    expect(ids(t)).toEqual([0])
  })

  it('works with an async schema once validation settles', async () => {
    const t = createTable({
      schema: makeSchema(
        (v) =>
          typeof (v as { ok?: unknown }).ok === 'boolean' && (v as { ok: boolean }).ok
            ? { value: v }
            : { issues: [{ message: 'not ok', path: ['ok'] }] },
        { async: true },
      ),
      data: [{ ok: true }, { ok: false }, { ok: true }],
      invalidRows: 'flag',
      features: [validity()],
      initialState: { validity: 'invalid' },
      onDiagnostic,
    })
    expect(t.getRowModel().status).toBe('validating')
    await new Promise((r) => setTimeout(r, 0))
    expect(ids(t)).toEqual([1])
  })

  it('a slice that is not a validity value reads as all and reports DK_INVALID_VALIDITY', () => {
    const t = flagTable()
    t.setState((s) => ({ ...s, validity: 'broken' as never }))
    expect(ids(t)).toEqual([0, 1, 2, 3])
    const d = find('DK_INVALID_VALIDITY') as Diagnostic
    expect(d.level).toBe('warn')
    expect(d.where).toEqual({ kind: 'option', path: 'state.validity' })
    expect(d.details).toMatchObject({ source: 'state', received: '"broken"' })
    expect(d.fix.join('\n')).toContain("'all' | 'valid' | 'invalid'")
  })

  it('setValidity with a bad value is ignored and reports DK_INVALID_VALIDITY', () => {
    const t = flagTable()
    t.setValidity('valid')
    t.setValidity('nope' as never)
    expect(t.getState().validity).toBe('valid')
    const d = find('DK_INVALID_VALIDITY') as Diagnostic
    expect(d.where).toEqual({ kind: 'operation', op: 'table.setValidity' })
    expect(d.details).toMatchObject({ source: 'setValidity' })
    expect(d.impact).toContain('ignored')
  })
})

describe('validity() outside flag mode: a no-op', () => {
  it('without a schema: every row stays; a non-all value emits DK_OPTION_NO_EFFECT', () => {
    const t = createTable({
      data: [{ a: 1 }, { a: 2 }],
      features: [validity()],
      onDiagnostic,
    })
    expect(ids(t)).toEqual([0, 1])
    expect(codes()).toEqual([])
    t.setValidity('invalid')
    expect(t.getState().validity).toBe('invalid')
    expect(ids(t)).toEqual([0, 1])
    const d = find('DK_OPTION_NO_EFFECT') as Diagnostic
    expect(d.level).toBe('warn')
    expect(d.where).toEqual({ kind: 'feature', name: 'validity' })
    expect(d.details).toMatchObject({ feature: 'validity', once: false })
    expect(String(d.details.reason)).toContain("invalidRows: 'flag'")
    expect(String(d.details.reason)).toContain('schema')
  })

  it("with invalidRows: 'drop': invalid rows are gone, 'invalid' keeps every remaining row", () => {
    const t = createTable({
      schema: userSchema,
      data: raw,
      columns,
      features: [validity()],
      initialState: { validity: 'invalid' },
      onDiagnostic,
    })
    expect(t.getRowModel().totalCount).toBe(2)
    expect(t.getRowModel().rows).toHaveLength(2)
    expect(codes()).toContain('DK_OPTION_NO_EFFECT')
    expect(String(find('DK_OPTION_NO_EFFECT')?.details.reason)).toContain("'drop'")
  })

  it("'all' outside flag mode is silent", () => {
    const t = createTable({ data: [{ a: 1 }], features: [validity()], onDiagnostic })
    t.setValidity('all')
    t.getRowModel()
    expect(codes()).toEqual([])
  })
})
