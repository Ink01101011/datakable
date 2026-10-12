import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from './diagnostics/types'
import { columnFilters } from './features/column-filters'
import { pagination } from './features/pagination'
import { search } from './features/search'
import { sorting } from './features/sorting'
import { validity } from './features/validity'
import { makeSchema } from './ingest/test-schemas'
import { defineInterceptor } from './intercept/define'
import { Row } from './pipeline/row'
import { createTable } from './table/create-table'

/**
 * Cross-unit integration (R6, extended R7 with T15 sort strategies, T17 search typing, T21 server
 * mode and T23 validity): rowKey (T11) + ingest checks (T12) + columnFilters (T13) +
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

describe('integration (R7): validity in flag mode with the other client steps', () => {
  it('filters valid / invalid rows and composes with column filters, search and paging', async () => {
    const t = createTable({
      schema,
      invalidRows: 'flag',
      data: rows(1000),
      rowKey: 'id',
      columns: [{ key: 'id' }, { key: 'name', search: 1 }, { key: 'city' }, { key: 'age' }],
      features: [pagination({ pageSize: 5 }), validity(), search(), columnFilters()],
      onDiagnostic: (d) => {
        seen.push(d)
      },
    })
    await settle()
    // i % 97 === 0 for i < 1000: 0, 97, …, 970.
    const invalid = 11
    t.setValidity('invalid')
    expect(t.getRowModel().filteredCount).toBe(invalid)
    for (const r of t.getRowModel().rows) {
      expect(r.valid).toBe(false)
      expect(r.getCellIssues('age')).toHaveLength(1)
      expect(r.getCellIssues('name')).toHaveLength(0)
    }
    t.setValidity('valid')
    expect(t.getRowModel().filteredCount).toBe(1000 - invalid)
    // + a column filter (same stage, ANDed): city index i % 5 === 2 (Phuket).
    t.setColumnFilter('city', { type: 'equals', value: 'Phuket' })
    const phuketInvalid = Array.from({ length: 1000 }, (_, i) => i).filter(
      (i) => i % 97 === 0 && i % 5 === 2,
    ).length
    expect(t.getRowModel().filteredCount).toBe(200 - phuketInvalid)
    t.setValidity('invalid')
    expect(t.getRowModel().filteredCount).toBe(phuketInvalid)
    t.setValidity('all')
    expect(t.getRowModel().filteredCount).toBe(200)
    expect(seen.map((d) => d.code)).not.toContain('DK_OPTION_NO_EFFECT')
  })

  it('outside flag mode the step passes rows through and reports DK_OPTION_NO_EFFECT', () => {
    const t = createTable({
      data: rows(20),
      features: [validity()],
      onDiagnostic: (d) => {
        seen.push(d)
      },
    })
    t.setValidity('invalid')
    expect(t.getRowModel().filteredCount).toBe(20)
    expect(seen.map((d) => d.code)).toContain('DK_OPTION_NO_EFFECT')
  })
})

describe('integration (R7): client search typing (fake timers)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounced typing: pending, no matching or page reset per keystroke; one commit', async () => {
    vi.useFakeTimers()
    const stages: string[] = []
    const t = createTable({
      schema,
      invalidRows: 'flag',
      data: rows(1000),
      rowKey: 'id',
      columns: [{ key: 'id' }, { key: 'name', search: 1 }, { key: 'city' }, { key: 'age' }],
      features: [
        pagination({ pageSize: 10 }),
        sorting(),
        search({ typing: { strategy: 'debounce', wait: 200 } }),
      ],
      interceptors: [
        defineInterceptor({
          name: 'steps',
          on: ['pipeline:step'],
          intercept(ctx, next) {
            stages.push((ctx.input as { stage: string }).stage)
            return next()
          },
        }),
      ],
    })
    await vi.advanceTimersByTimeAsync(0)
    const statuses: string[] = []
    t.subscribe(() => statuses.push(t.getRowModel().status))
    t.setPageIndex(4)
    const before = t.getRowModel().rows.map((r) => r.key)
    stages.length = 0
    for (const ch of ['p', 'pe', 'per', 'person 99']) {
      void t.setSearch(`${VALUE} ${ch}`)
      await vi.advanceTimersByTimeAsync(50)
    }
    // Typing only: the page stays, rows are not re-matched, the status is 'pending'.
    expect(t.getState().pagination.pageIndex).toBe(4)
    expect(t.getRowModel().rows.map((r) => r.key)).toEqual(before)
    // The search step is dispatched (its slice changed) but returns its input (query unchanged),
    // so the later steps hit their memo.
    expect(stages.filter((st) => st !== 'search')).toEqual([])
    expect(t.getRowModel().status).toBe('pending')
    await vi.advanceTimersByTimeAsync(200)
    expect(t.getState().search).toMatchObject({ query: `${VALUE} person 99`, status: 'idle' })
    expect(t.getState().pagination.pageIndex).toBe(0)
    expect(t.getRowModel().status).toBe('idle')
    expect(t.getRowModel().rows.map((r) => r.getValue('name'))).toContain(`${VALUE} person 99`)
    // idle → pending once, pending → idle once (other notifications are state changes).
    const transitions = statuses.filter((s, i) => i === 0 || s !== statuses[i - 1])
    expect(transitions).toEqual(['idle', 'pending', 'idle'])
  })
})

describe('integration (R7): server sorting + pagination with a fetcher', () => {
  type Call = { params: Record<string, unknown>; resolve: (r: unknown) => void }

  function serverTable() {
    const calls: Call[] = []
    const t = createTable({
      fetcher: (params) =>
        new Promise<{ rows: U[]; rowCount: number }>((resolve) => {
          const { signal: _signal, ...rest } = params
          calls.push({ params: rest, resolve: resolve as (r: unknown) => void })
        }),
      rowKey: 'id',
      columns: [{ key: 'id' }, { key: 'name' }, { key: 'city' }, { key: 'age', sortable: true }],
      // Listed out of stage order; a client filter would precede them (DK_MODE_ORDER).
      features: [pagination({ pageSize: 10, mode: 'server' }), sorting({ mode: 'server' })],
      onDiagnostic: (d) => {
        seen.push(d)
      },
    })
    return { t, calls }
  }

  /** A server page: deliberately not in client sort order (core must not re-sort it). */
  const page = (pageIndex: number) =>
    rows(10).map((r, i) => ({ ...(r as U), id: `p${pageIndex}-${i}`, age: (i * 7) % 10 }))

  it('sends sort and page state to the fetcher and shows its rows as given', async () => {
    const { t, calls } = serverTable()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.params).toEqual({ sort: [], pageIndex: 0, pageSize: 10 })
    expect(t.getRowModel().status).toBe('fetching')
    calls[0]?.resolve({ rows: page(0), rowCount: 95 })
    await settle()

    const m = t.getRowModel()
    expect(m.status).toBe('idle')
    expect(m.isInitialLoad).toBe(false)
    expect(t.getPageCount()).toBe(10)
    expect(m.rows.map((r) => r.key)).toEqual(page(0).map((r) => r.id))

    t.setPageIndex(3)
    expect(calls.at(-1)?.params).toEqual({ sort: [], pageIndex: 3, pageSize: 10 })
    calls.at(-1)?.resolve({ rows: page(3), rowCount: 95 })
    await settle()
    expect(t.getRowModel().rows[0]?.key).toBe('p3-0')

    // A sort change goes to the server and resets the page (one request with both).
    t.toggleSort('age')
    expect(t.getState().pagination.pageIndex).toBe(0)
    expect(calls.at(-1)?.params).toEqual({
      sort: [{ id: 'age', desc: false }],
      pageIndex: 0,
      pageSize: 10,
    })
    const sortedOnServer = page(0)
    calls.at(-1)?.resolve({ rows: sortedOnServer, rowCount: 95 })
    await settle()
    // Server order kept: core skipped its sort and page steps.
    expect(t.getRowModel().rows.map((r) => r.getValue('age'))).toEqual(
      sortedOnServer.map((r) => r.age),
    )
    expect(t.getRowModel().rows).toHaveLength(10)
    // The same params do not refetch.
    const n = calls.length
    t.setPageIndex(0)
    expect(calls).toHaveLength(n)
  })

  it('a client step before a server step is a config error (DK_MODE_ORDER)', () => {
    expect(() =>
      createTable({
        fetcher: () => ({ rows: [] }),
        features: [columnFilters(), sorting({ mode: 'server' })],
      }),
    ).toThrow(/DK_MODE_ORDER/)
  })

  it('a bad response is reported and keeps the previous rows with error status', async () => {
    const { t, calls } = serverTable()
    calls[0]?.resolve({ rows: page(0), rowCount: 95 })
    await settle()
    t.setPageIndex(1)
    calls.at(-1)?.resolve({ rows: 'nope' })
    await settle()
    expect(seen.map((d) => d.code)).toContain('DK_FETCH_BAD_RESPONSE')
    expect(t.getRowModel().status).toBe('error')
    expect(t.getRowModel().rows[0]?.key).toBe('p0-0')
  })
})
