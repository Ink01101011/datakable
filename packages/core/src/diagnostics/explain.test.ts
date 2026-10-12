import { describe, expect, it, vi } from 'vitest'
import { defineFeature } from '../feature/define'
import { columnFilters } from '../features/column-filters'
import { pagination } from '../features/pagination'
import { search } from '../features/search'
import { sorting } from '../features/sorting'
import { validity } from '../features/validity'
import { userSchema } from '../ingest/test-schemas'
import { createTable } from '../table/create-table'
import { hashRowKey } from './redact'

type Product = { id: number; name: string; price: number; owner: string }

const products: Product[] = [
  { id: 1, name: 'Anvil', price: 120, owner: 'SECRET-123' },
  { id: 2, name: 'Bucket', price: 40, owner: 'SECRET-123' },
  { id: 3, name: 'Chisel', price: 300, owner: 'SECRET-123' },
  { id: 4, name: 'Drill', price: 220, owner: 'SECRET-123' },
  { id: 5, name: 'Easel', price: 90, owner: 'SECRET-123' },
]

const columns = [
  { key: 'id' },
  { key: 'name' },
  { key: 'price' },
  { key: 'owner', sensitive: true },
] as const

const features = () =>
  [columnFilters(), validity(), search(), sorting(), pagination({ pageSize: 2 })] as const

const make = (extra: Record<string, unknown> = {}) =>
  createTable({
    data: products,
    columns,
    rowKey: 'id',
    features: features(),
    diagnostics: { redact: 'keys' },
    onDiagnostic: () => {},
    ...extra,
  } as never) as unknown as ReturnType<typeof typed>

const typed = () => createTable({ data: products, columns, rowKey: 'id', features: features() })

describe('explain() (§8.4)', () => {
  it('summarises the last run: rows per step, page and run id', () => {
    const t = make()
    t.setColumnFilter('price', { type: 'range', value: { min: 100 } })
    const e = t.explain()
    expect(e.run).toBeGreaterThan(0)
    expect(e.trigger).toBe('api:setColumnFilter')
    expect(e.rows).toBe(5)
    expect(e.steps.map((s) => [s.feature, s.input, s.output])).toEqual([
      ['columnFilters', 5, 3],
      ['validity', 3, 3],
      ['search', 3, 3],
      ['sorting', 3, 3],
      ['pagination', 3, 2],
    ])
    expect(e.page).toEqual({ index: 0, count: 2, size: 2 })
    expect(e.visible).toBe(2)
    const text = String(e)
    expect(text).toContain(`run ${e.run}`)
    expect(text).toContain('5 rows')
    expect(text).toContain('columnFilters 3')
    expect(text).toContain('page 1/2 (2)')
  })

  it('carries tracer timings in development (the tracer is installed by default)', () => {
    const t = make()
    const e = t.explain()
    expect(e.traced).toBe(true)
    expect(typeof e.ms).toBe('number')
    for (const s of e.steps) expect(typeof s.ms === 'number' || s.cached).toBe(true)
  })

  it('reports schema drops and counts open diagnostics', () => {
    const t = createTable({
      data: [
        { id: 1, name: 'a', age: 1 },
        { id: 2, name: 'b', age: 'x' },
        { id: 3, name: 'c', age: 3 },
      ],
      schema: userSchema,
      rowKey: 'id',
      features: [sorting()],
      onDiagnostic: () => {},
    })
    const e = t.explain()
    expect(e.schema).toEqual({ mode: 'drop', invalid: 1 })
    expect(e.rows).toBe(2)
    expect(e.diagnostics).toBeGreaterThan(0)
    expect(String(e)).toContain('schema 2 (1 dropped)')
  })

  it('marks server-mode steps as handled by the server', () => {
    const t = createTable({
      data: products,
      columns,
      features: [columnFilters({ mode: 'server' }), sorting()],
      rowCount: 5,
      onDiagnostic: () => {},
    })
    const e = t.explain()
    expect(e.steps[0]).toMatchObject({ feature: 'columnFilters', mode: 'server' })
    expect(String(e)).toContain('columnFilters (server)')
  })

  it('never changes state or notifies', () => {
    const t = make()
    const listener = vi.fn()
    t.subscribe(listener)
    const s = t.getState()
    const m = t.getRowModel()
    t.explain()
    t.explainRow(3)
    expect(t.getState()).toBe(s)
    expect(t.getRowModel()).toBe(m)
    expect(listener).not.toHaveBeenCalled()
  })

  it('explain and explainRow are core names: a feature cannot take them', () => {
    const f = defineFeature({
      name: 'x',
      stage: 'none',
      initialState: () => ({}),
      createApi: () => ({ explain: () => 1 }),
    })
    expect(() => createTable({ data: products, features: [f] })).toThrow(/DK_FEATURE_API_CONFLICT/)
  })
})

describe('explainRow(key) pinpoints the removing step (§8.4)', () => {
  it('columnFilters: names the step and the rejecting filter', () => {
    const t = make()
    t.setColumnFilter('price', { type: 'range', value: { min: 100 } })
    const e = t.explainRow(2)
    expect(e.found).toBe(true)
    expect(e.index).toBe(1)
    expect(e.removedBy).toBe('columnFilters')
    expect(e.visible).toBe(false)
    const step = e.steps.find((s) => s.feature === 'columnFilters')
    expect(step?.outcome).toBe('removed')
    expect(step?.detail).toMatchObject({ filters: [{ column: 'price', type: 'range' }] })
    const later = e.steps.filter((s) => s.stage !== 'filter')
    for (const s of later) expect(s.outcome).toBe('not-reached')
    const text = String(e)
    expect(text).toMatch(/✗ columnFilters .*price range.*← removed here/)
    expect(text).toContain('fix')
  })

  it('columnFilters: only the filters that reject the row are named', () => {
    const t = make()
    t.setColumnFilter('price', { type: 'range', value: { min: 100 } })
    t.setColumnFilter('name', { type: 'contains', value: 'u' })
    // Bucket: price 40 (rejected), name contains 'u' (passes).
    const e = t.explainRow(2)
    expect(e.steps[0]?.detail).toMatchObject({ filters: [{ column: 'price' }] })
  })

  it('a kept row shows every step and its position and page', () => {
    const t = make()
    t.toggleSort('price')
    const e = t.explainRow(1) // Anvil, price 120: sorted 40, 90, 120, 220, 300 → position 3, page 2
    expect(e.removedBy).toBe('pagination')
    const sort = e.steps.find((s) => s.feature === 'sorting')
    expect(sort).toMatchObject({ outcome: 'kept', position: 2, of: 5 })
    const page = e.steps.find((s) => s.feature === 'pagination')
    expect(page).toMatchObject({ outcome: 'removed', detail: { page: 2, currentPage: 1 } })
    expect(String(e)).toContain('setPageIndex(1)')

    t.setPageIndex(1)
    const shown = t.explainRow(1)
    expect(shown.visible).toBe(true)
    expect(shown.removedBy).toBeUndefined()
    expect(shown.steps.every((s) => s.outcome === 'kept')).toBe(true)
  })

  it('search: names the step with the query length and threshold, never the query', () => {
    const t = make()
    void t.setSearch('Chisel')
    const e = t.explainRow(1)
    expect(e.removedBy).toBe('search')
    expect(e.steps.find((s) => s.feature === 'search')?.detail).toEqual({
      queryLength: 6,
      threshold: 0.3,
    })
    const text = String(e)
    expect(text).toContain('query (6 chars)')
    expect(text).not.toContain('Chisel')
    expect(text).toContain('threshold')
  })

  it('validity: a flagged row hidden by validity "valid"', () => {
    const t = createTable({
      data: [
        { id: 1, name: 'a', age: 1 },
        { id: 2, name: 'b', age: 'x' },
      ],
      schema: userSchema,
      invalidRows: 'flag',
      rowKey: 'id',
      features: [validity()],
      onDiagnostic: () => {},
    })
    t.setValidity('valid')
    const e = t.explainRow(2)
    expect(e.schema).toBe('flagged')
    expect(e.issues).toEqual([{ path: 'age', message: 'invalid value at age' }])
    expect(e.removedBy).toBe('validity')
    expect(String(e)).toContain("setValidity('all')")
  })

  it('schema: a dropped row is reported as removed by the schema', () => {
    const t = createTable({
      data: [
        { id: 1, name: 'a', age: 1 },
        { id: 2, name: 'b', age: 'SECRET-123' },
      ],
      schema: userSchema,
      rowKey: 'id',
      features: [sorting()],
      onDiagnostic: () => {},
    })
    const e = t.explainRow(2)
    expect(e.found).toBe(true)
    expect(e.schema).toBe('dropped')
    expect(e.removedBy).toBe('schema')
    expect(e.steps.every((s) => s.outcome === 'not-reached')).toBe(true)
    expect(JSON.stringify(e)).not.toContain('SECRET-123')
    expect(String(e)).not.toContain('SECRET-123')
    expect(String(e)).toContain("invalidRows: 'flag'")
  })

  it('a custom feature: the step that dropped the row is named', () => {
    const odd = defineFeature({
      name: 'oddOnly',
      stage: 'filter',
      initialState: () => true,
      createApi: () => ({}),
      rowModel: (indices) => indices.filter((i) => i % 2 === 1),
    })
    const t = createTable({ data: products, rowKey: 'id', features: [odd, sorting()] })
    expect(t.explainRow(1).removedBy).toBe('oddOnly')
    expect(t.explainRow(2).removedBy).toBeUndefined()
  })

  it('server-mode steps are skipped', () => {
    const t = createTable({
      data: products,
      columns,
      rowKey: 'id',
      features: [columnFilters({ mode: 'server' }), sorting()],
      rowCount: 5,
    })
    const e = t.explainRow(1)
    expect(e.steps[0]).toMatchObject({ feature: 'columnFilters', outcome: 'skipped' })
    expect(e.visible).toBe(true)
  })

  it('an unknown key is reported as not found', () => {
    const t = make()
    const e = t.explainRow(999)
    expect(e.found).toBe(false)
    expect(String(e)).toContain('not found')
  })

  it("redaction 'safe': keys are hashed; no cell or filter value appears", () => {
    const t = make({ diagnostics: { redact: 'safe' } })
    t.setColumnFilter('owner', { type: 'equals', value: 'nobody' })
    const e = t.explainRow(2)
    expect(e.key).toBe(hashRowKey(2))
    const out = `${JSON.stringify(e)}\n${String(e)}\n${JSON.stringify(t.explain())}\n${t.explain()}`
    expect(out).not.toContain('SECRET-123')
    expect(out).not.toContain('nobody')
    // owner is a sensitive column: never shown, even as a type.
    expect(e.steps[0]?.detail).toMatchObject({
      filters: [{ column: 'owner', value: '[sensitive]', cell: '[sensitive]' }],
    })
  })

  it("redaction 'keys' shows the raw key and value types; 'full' shows values", () => {
    const keys = make()
    keys.setColumnFilter('price', { type: 'range', value: { min: 100 } })
    const k = keys.explainRow(2)
    expect(k.key).toBe(2)
    expect(k.steps[0]?.detail).toMatchObject({ filters: [{ value: 'object', cell: 'number' }] })
    const full = make({ diagnostics: { redact: 'full' } })
    full.setColumnFilter('price', { type: 'range', value: { min: 100 } })
    expect(full.explainRow(2).steps[0]?.detail).toMatchObject({
      filters: [{ value: { min: 100 }, cell: 40 }],
    })
  })
})
