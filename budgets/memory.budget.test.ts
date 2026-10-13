import { createDefaultFeatures, createTable } from '@datakable/core'
import { describe, expect, it } from 'vitest'
import { measureHeap } from './measure'

// §9.3 "Pipeline memory at 100k rows (excluding source data) ≤ 5 MB" with the REAL default preset
// (columnFilters, validity, search, sorting, pagination) from the built `@datakable/core`, in
// production mode (T37). Memory = JS heap + typed-array backing stores after two full GCs, taken
// after the source data exists and while the table is alive: what the table adds on top of `data`.
//
// Scenarios: 100k rows `{ id, age, name }`, all columns derived (zero-config), filter `age ≥ 10`
// (90k rows kept), sort by `age`; then the default page of 10 rows, a client search on top, or no
// pagination (90k visible rows). Every scenario is held to the 5 MB spec budget (F2): `rows` builds
// a Row only when its index is read, and search keeps no per-row projection (search-index.ts).

const N = 100_000
type R = { id: number; age: number; name: string }
const makeData = (): R[] =>
  Array.from({ length: N }, (_, i) => ({ id: i, age: (i * 7919) % 100, name: `name ${i}` }))

const BUDGET_MB = 5

function preset(data: R[]) {
  return createTable({ data, rowKey: 'id', features: createDefaultFeatures(), onDiagnostic() {} })
}

describe('§9.3 pipeline memory, real default preset, 100k rows (dist, production)', () => {
  it(`filter + sort, paginated (10 rows): ≤ ${BUDGET_MB} MB`, () => {
    const data = makeData()
    const { mb, value: t } = measureHeap(() => {
      const t = preset(data)
      t.getRowModel()
      t.setColumnFilter('age', { type: 'range', value: { min: 10 } })
      t.toggleSort('age')
      t.getRowModel()
      return t
    })
    const m = t.getRowModel()
    console.info(`[§9.3 memory] filter+sort, paginated: ${mb.toFixed(2)} MB (budget ${BUDGET_MB})`)
    expect(m.rows).toHaveLength(10)
    expect(m.filteredCount).toBe(data.filter((r) => r.age >= 10).length)
    expect(mb).toBeLessThanOrEqual(BUDGET_MB)
    expect(t.getData()).toBe(data)
  })

  it(`client search applied: ≤ ${BUDGET_MB} MB`, async () => {
    const data = makeData()
    const { mb, value: t } = await measureHeap(async () => {
      const t = preset(data)
      t.getRowModel()
      t.setColumnFilter('age', { type: 'range', value: { min: 10 } })
      t.toggleSort('age')
      await expect(t.setSearch('name 99')).resolves.toEqual({ status: 'applied' })
      t.getRowModel()
      return t
    })
    const m = t.getRowModel()
    console.info(`[§9.3 memory] filter+sort+search: ${mb.toFixed(2)} MB (budget ${BUDGET_MB})`)
    expect(t.getState().search.query).toBe('name 99')
    expect(m.filteredCount).toBeGreaterThan(0)
    expect(mb).toBeLessThanOrEqual(BUDGET_MB)
    expect(t.getData()).toBe(data)
  })

  it(`filter + sort, unpaginated (90k visible rows): ≤ ${BUDGET_MB} MB`, () => {
    const data = makeData()
    const { mb, value: t } = measureHeap(() => {
      const t = preset(data)
      t.setPageSize(N)
      t.setColumnFilter('age', { type: 'range', value: { min: 10 } })
      t.toggleSort('age')
      t.getRowModel()
      return t
    })
    const m = t.getRowModel()
    console.info(
      `[§9.3 memory] filter+sort, unpaginated: ${mb.toFixed(2)} MB (budget ${BUDGET_MB})`,
    )
    expect(m.rows).toHaveLength(m.filteredCount)
    expect(mb).toBeLessThanOrEqual(BUDGET_MB)
    expect(t.getData()).toBe(data)
  })
})
