import { describe, expect, it, vi } from 'vitest'
import { columnFilters } from '../features/column-filters'
import { pagination } from '../features/pagination'
import { createTable } from '../table/create-table'

/**
 * Decision 7 (§8.4, decided 2026-10-13): `explain()` and `explainRow()` stay available in a
 * production build. Without the tracer they recompute on demand; `String(…)` is JSON there.
 */
vi.mock('./env', () => ({ DEV: false }))

const data = [
  { id: 1, price: 120 },
  { id: 2, price: 40 },
  { id: 3, price: 300 },
]

describe('explain() / explainRow() in production', () => {
  it('both work and serialise to JSON', () => {
    const t = createTable({
      data,
      rowKey: 'id',
      features: [columnFilters(), pagination({ pageSize: 2 })],
      onDiagnostic: () => {},
    })
    t.setColumnFilter('price', { type: 'range', value: { min: 100 } })
    const e = t.explain()
    expect(e.rows).toBe(3)
    expect(e.steps.map((s) => [s.feature, s.input, s.output])).toEqual([
      ['columnFilters', 3, 2],
      ['pagination', 2, 2],
    ])
    expect(JSON.parse(String(e))).toMatchObject({ rows: 3 })
    const r = t.explainRow(2)
    expect(r.visible).toBe(false)
    expect(r.removedBy).toBe('columnFilters')
    expect(JSON.parse(String(r))).toMatchObject({ visible: false, removedBy: 'columnFilters' })
  })
})
