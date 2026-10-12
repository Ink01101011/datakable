import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from './diagnostics/types'
import { columnFilters } from './features/column-filters'
import { pagination } from './features/pagination'
import { search } from './features/search'
import { sorting } from './features/sorting'
import { makeSchema } from './ingest/test-schemas'
import { defineInterceptor } from './intercept/define'
import { Row } from './pipeline/row'
import { createTable } from './table/create-table'

/**
 * Cross-unit integration (R6): rowKey (T11) + ingest checks (T12) + columnFilters (T13) +
 * sorting (T14) + search (T16) + pagination (T20) + schema flag mode (T22) + dev checks (T27) on
 * one ~1k-row table. Row keys and cell values carry a sentinel that must never reach a `ctx.where`
 * or a diagnostic (outside `context.cause`).
 */
const SENTINEL = 'SECRET-9f3'
/** Cell values only (row keys use {@link SENTINEL}): allowed nowhere, at any redaction level. */
const VALUE = 'VALUE-c7e'
const CITIES = ['Bangkok', 'Chiang Mai', 'Phuket', 'Khon Kaen', 'Hat Yai']

type U = { id: string; name: string; city: string; age: number }

const rows = (n: number): unknown[] =>
  Array.from({ length: n }, (_, i) => ({
    // Row 500 duplicates row 499's key (DK_DUPLICATE_ROW_KEY carries a key: redacted).
    id: `${SENTINEL}-${i === 500 ? 499 : i}`,
    name: `${VALUE} person ${i}`,
    city: CITIES[i % CITIES.length],
    // Every 97th row is invalid (flag mode keeps it; the issue message embeds the value).
    age: i % 97 === 0 ? `${VALUE}-age` : (i * 37) % 90,
  }))

const schema = makeSchema<U>(
  (v) => {
    const r = v as Record<string, unknown>
    return typeof r.age === 'number'
      ? { value: v as U }
      : { issues: [{ message: `Expected number, received ${String(r.age)}`, path: ['age'] }] }
  },
  { async: true },
)

let seen: Diagnostic[]
beforeEach(() => {
  seen = []
  for (const m of ['error', 'warn', 'info', 'log', 'groupCollapsed', 'group', 'groupEnd'] as const)
    vi.spyOn(console, m).mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

function setup(redact: 'safe' | 'keys' = 'keys') {
  const stages: string[] = []
  const wheres: string[] = []
  const statuses: string[] = []
  const t = createTable({
    schema,
    invalidRows: 'flag',
    data: rows(1000),
    rowKey: 'id',
    columns: [
      { key: 'id' },
      { key: 'name', search: 1 },
      { key: 'city', filter: { type: 'equals' } },
      { key: 'age', sortable: true },
    ],
    // Listed out of stage order: the pipeline orders them filter → search → sort → paginate.
    features: [pagination({ pageSize: 10 }), sorting(), search(), columnFilters()],
    diagnostics: { redact },
    onDiagnostic: (d) => {
      seen.push(d)
    },
    interceptors: [
      defineInterceptor({
        name: 'audit',
        on: '*',
        hot: true,
        intercept(ctx, next) {
          wheres.push(ctx.where)
          if (ctx.op === 'pipeline:step') stages.push((ctx.input as { stage: string }).stage)
          return next()
        },
      }),
    ],
  })
  t.subscribe(() => {
    statuses.push(t.getRowModel().status)
  })
  return { t, stages, wheres, statuses }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

describe('integration: filter + search + sort + paginate + schema (flag) + rowKey', () => {
  it('runs the stages in order and composes their outputs', async () => {
    const { t, stages } = setup()
    expect(t.getRowModel().status).toBe('validating')
    expect(t.getRowModel().isInitialLoad).toBe(true)
    await settle()

    const all = t.getRowModel()
    expect(all.status).toBe('idle')
    expect(all.isInitialLoad).toBe(false)
    expect(all.totalCount).toBe(1000) // flag mode keeps invalid rows
    expect(all.rows).toHaveLength(10)
    expect(all.rows[0]).toBeInstanceOf(Row)
    expect(all.rows[0]?.valid).toBe(false) // row 0: i % 97 === 0
    expect(all.rows[0]?.getCellIssues('age')).toHaveLength(1)

    stages.length = 0
    t.setColumnFilter('city', { type: 'equals', value: 'Phuket' })
    // A filter change re-runs every later step (each is memoised on its input reference).
    expect(stages).toEqual(['filter', 'search', 'sort', 'paginate'])
    await t.setSearch(`${VALUE} person 1`)
    t.toggleSort('age')
    t.toggleSort('age') // desc
    const m = t.getRowModel()

    expect(m.filteredCount).toBeGreaterThan(10)
    expect(m.filteredCount).toBeLessThanOrEqual(200)
    expect(m.rows).toHaveLength(10)
    for (const r of m.rows) expect((r.original as U).city).toBe('Phuket')
    const ages = m.rows.map((r) => r.getValue('age'))
    const numeric = ages.filter((a): a is number => typeof a === 'number')
    expect(numeric).toEqual([...numeric].sort((a, b) => b - a))
    // Mixed types order by type rank (§6.4): the invalid (string) ages form one block, not
    // interleaved with the numbers (desc reverses the rank).
    const kinds = ages.map((a) => typeof a)
    expect(kinds.filter((k, i) => i > 0 && k !== kinds[i - 1]).length).toBeLessThanOrEqual(1)

    // Duplicate key fallback (§5.2).
    t.clearSearch()
    t.resetColumnFilters()
    t.clearSorting()
    t.setPageSize(1000)
    const keys = t.getRowModel().rows.map((r) => r.key)
    expect(keys[499]).toBe(`${SENTINEL}-499`)
    expect(keys[500]).toBe(`${SENTINEL}-499#1`)
  })

  it('auto-resets pageIndex on a filter, search or sort change', async () => {
    const { t } = setup()
    await settle()
    const page = () => t.getState().pagination.pageIndex

    t.setPageIndex(3)
    expect(page()).toBe(3)
    t.setColumnFilter('city', { type: 'equals', value: 'Bangkok' })
    expect(page()).toBe(0)

    t.setPageIndex(2)
    await t.setSearch(`${VALUE} person`)
    expect(page()).toBe(0)

    t.setPageIndex(1)
    t.toggleSort('age')
    expect(page()).toBe(0)

    // A page change alone keeps the page.
    t.setPageIndex(2)
    expect(page()).toBe(2)
  })

  it('status is never silent: validating then idle, each change notified once', async () => {
    const { t, statuses } = setup()
    expect(t.getRowModel().status).toBe('validating')
    await settle()
    expect(statuses).toEqual(['idle'])
    // A new data array with an async schema: 'validating' is notified, then 'idle'.
    t.setOptions({ data: rows(1000) })
    expect(t.getRowModel().status).toBe('validating')
    await settle()
    expect(statuses).toEqual(['idle', 'validating', 'idle'])
  })

  it.each(['safe', 'keys'] as const)(
    "redact '%s': no ctx.where carries a key, value or query; diagnostics no value",
    async (level) => {
      const { t, wheres } = setup(level)
      await settle()
      t.setColumnFilter('city', { type: 'equals', value: 'Hat Yai' })
      await t.setSearch(`${VALUE} person 4`)
      t.toggleSort('age')
      t.setPageIndex(1)
      t.setOptions({ data: rows(1000) })
      await settle()
      t.getRowModel()
      t.destroy()

      const codes = new Set(seen.map((d) => d.code))
      // The sentinels were offered to diagnostics through keys and schema issue messages.
      expect(codes).toContain('DK_DUPLICATE_ROW_KEY')
      expect(codes).toContain('DK_SCHEMA_INVALID_ROW')
      expect(wheres.length).toBeGreaterThan(20)
      for (const w of wheres) {
        expect(w).not.toContain(SENTINEL)
        expect(w).not.toContain(VALUE)
      }
      for (const d of seen) {
        // toJSON leaves out only `context.cause` (which reaches onDiagnostic by design, §8.2).
        const text = JSON.stringify(d)
        expect(text).not.toContain(VALUE)
        // Raw row keys are allowed under 'keys' only (§8.2).
        if (level === 'safe') expect(text).not.toContain(SENTINEL)
      }
    },
  )
})
