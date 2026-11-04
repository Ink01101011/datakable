import { defineOptions } from '../../catalog/options'
import { keepDiagnostics } from '../../diagnostics/catalog'
import { DEV } from '../../diagnostics/env'
import { describeValue } from '../../diagnostics/redact'
import { defineFeature } from '../../feature/define'
import { type SliceFix, sliceGuard } from '../../feature/slice-guard'
import type { RowModelContext } from '../../feature/types'
import { CellFailures } from '../../intercept/cell-batch'
import { errorName } from '../../intercept/classify'
import { boundaryDiagnostics } from '../../intercept/codes'
import type { ColumnValues } from '../../pipeline/types'
import { type DataMode, modeOption } from '../../source/mode'
import { PROTO_KEY } from '../../table/state-codes'
import { columnFiltersDiagnostics } from './codes'
import {
  BAD,
  type Compiled,
  compile,
  MATCH,
  NO,
  type Outcome,
  type RawFilter,
  type Test,
  typeName,
} from './match'
import type { ColumnFiltersState, ColumnFiltersTypes } from './types'

keepDiagnostics(columnFiltersDiagnostics, boundaryDiagnostics)

export interface ColumnFiltersOptions {
  /**
   * `'server'`: the server filters (the slice goes to `options.fetcher` as `filters`, or the app
   * fetches); core skips this step (§7.1). Default `'client'`.
   */
  mode?: DataMode
}

const columnFiltersOptions = { mode: modeOption } as const

/** Position of column `id` in `options.columns` (diagnostic `where`); `-1` if absent. */
function columnIndex(columns: readonly unknown[], id: string): number {
  for (let i = 0; i < columns.length; i++) {
    const c = columns[i] as { key?: unknown; id?: unknown } | null | undefined
    if (c && typeof c === 'object' && (typeof c.key === 'string' ? c.key : c.id) === id) return i
  }
  return -1
}

function columnIds(columns: readonly unknown[]): string[] {
  const out: string[] = []
  for (const c of columns as readonly ({ key?: unknown; id?: unknown } | null)[]) {
    const id = c && (typeof c.key === 'string' ? c.key : c.id)
    if (typeof id === 'string') out.push(id)
  }
  return out
}

/** Nullish and `NaN` (nullish in a numeric column cache) match no active filter (§6.1). */
const absent = (v: unknown) =>
  v === undefined || v === null || (typeof v === 'number' && Number.isNaN(v))

/** One cell: an array cell matches if any element matches, else `BAD` if one had a wrong type. */
function testCell(test: Test, v: unknown, r: number): Outcome {
  if (!Array.isArray(v)) return test(v, r)
  let out: Outcome = NO
  for (let i = 0; i < v.length; i++) {
    const e = v[i]
    if (absent(e)) continue
    const o = test(e, -1)
    if (o === MATCH) return MATCH
    if (o === BAD) out = BAD
  }
  return out
}

/**
 * Per-batch failures, recorded as numbers (§3.4) and reused across runs: wrong-type cells, or
 * throwing `custom` calls. Text and `where` are built only when something failed.
 */
const failures = new CellFailures()
const first = { type: '', error: undefined as unknown }

/** Keeps the rows of `rows[0..n)` that pass `c`, compacted into `out` (may be `rows`). */
function apply(
  c: Extract<Compiled, { kind: 'test' | 'custom' }>,
  values: ColumnValues,
  data: readonly unknown[],
  rows: Uint32Array,
  n: number,
  out: Uint32Array,
): number {
  let k = 0
  if (c.kind === 'custom') {
    const { fn, value } = c
    for (let i = 0; i < n; i++) {
      const r = rows[i] as number
      const v = values[r]
      if (absent(v)) continue
      try {
        if (fn(v, value, data[r])) out[k++] = r
      } catch (e) {
        if (failures.count === 0) first.error = e
        failures.add(r, e)
      }
    }
    return k
  }
  const test = c.test
  for (let i = 0; i < n; i++) {
    const r = rows[i] as number
    const v = values[r]
    if (absent(v)) continue
    const o = testCell(test, v, r)
    if (o === MATCH) out[k++] = r
    else if (o === BAD) {
      if (failures.count === 0) first.type = typeName(v)
      failures.add(r, undefined)
    }
  }
  return k
}

function report(ctx: RowModelContext, c: Compiled, id: string, kind: string, index: number) {
  if (c.kind === 'custom') {
    // Like a column:batch filterFn failure (§3.4); `where` is the filter's state path.
    const name = errorName(first.error)
    ctx.emit(
      'DK_CALLBACK_FAILED',
      {
        slot: `state.columnFilters.${id}.fn`,
        column: id,
        rows: Array.from(failures.sample()),
        count: failures.count,
        fallback: 'rows-unmatched',
        ...(name === undefined ? {} : { errorName: name }),
      },
      { cause: first.error },
    )
  } else if (c.kind === 'test') {
    ctx.emit('DK_FILTER_TYPE_MISMATCH', {
      column: id,
      index,
      filter: kind,
      source: 'cell',
      expected: c.expected,
      received: first.type,
      count: failures.count,
      rows: Array.from(failures.sample()),
    })
  }
}

/**
 * Applies every active column filter (AND) to `indices`: one pass per filtered column over the
 * column cache (§9.1), no per-cell allocation. Returns `indices` itself when nothing is active;
 * otherwise a new array (`indices` is never mutated).
 */
function filterRows(
  indices: Uint32Array,
  state: Readonly<Record<string, unknown>> | undefined,
  ctx: RowModelContext,
): Uint32Array {
  if (!state || typeof state !== 'object') return indices
  let out: Uint32Array | undefined
  let n = indices.length
  for (const id of Object.keys(state)) {
    const filter = state[id]
    if (filter === undefined) continue
    const values = ctx.getColumnValues(id)
    if (!values) {
      // Not a column (§7.2): ignored. No columns at all (zero-config, no rows yet) is not reported.
      if (ctx.columns.length > 0) {
        ctx.emit('DK_STATE_UNKNOWN_KEY', {
          slice: 'columnFilters',
          key: id,
          known: columnIds(ctx.columns),
        })
      }
      continue
    }
    const c = compile(filter, values)
    if (c.kind === 'off') continue
    const index = columnIndex(ctx.columns, id)
    if (c.kind === 'bad') {
      ctx.emit('DK_FILTER_TYPE_MISMATCH', {
        column: id,
        index,
        filter: c.filter,
        source: 'filter',
        expected: c.expected,
        received: c.received,
        count: 0,
        rows: [],
      })
      return new Uint32Array(0)
    }
    const src = out ?? indices
    out ??= new Uint32Array(indices.length)
    failures.reset()
    first.error = undefined
    try {
      if (c.kind === 'custom') {
        // A user callback per cell: one `filterFn` column:batch (§3.4). A skipped batch keeps
        // the slot fallback: no row matches.
        const rows = src.subarray(0, n)
        const dst = out
        let k = 0
        ctx.batch(id, 'filterFn', rows, () => {
          k = apply(c, values, ctx.data, rows, rows.length, dst)
        })
        n = k
      } else n = apply(c, values, ctx.data, src, n, out)
      if (failures.count > 0) report(ctx, c, id, String((filter as RawFilter).type), index)
    } finally {
      failures.reset()
      first.error = undefined
    }
  }
  return out ? out.subarray(0, n) : indices
}

const isSlice = (s: unknown): s is Record<string, unknown> =>
  s !== null && typeof s === 'object' && !Array.isArray(s)

/** A restored slice that is not an object (e.g. `null`) is replaced with no filters (#89). */
const fixSlice = (s: unknown): SliceFix<ColumnFiltersState<unknown>> | undefined =>
  isSlice(s) ? undefined : [{}, describeValue(s), '{}']

/**
 * Column filters (§6.1): `equals`, `contains` (case-insensitive, NFC), `in`, `range` (inclusive),
 * `custom`. Filters combine with AND; nullish cells match no active filter; array cells match if
 * any element matches; a cell of the wrong runtime type is a non-match + `DK_FILTER_TYPE_MISMATCH`.
 *
 * ```ts
 * const table = createTable({ data: users, columns, features: [columnFilters()] })
 * table.setColumnFilter('age', { type: 'range', value: { min: 18 } })
 * table.setColumnFilter('name', { type: 'contains', value: 'ada' })
 * ```
 */
export const columnFilters = (opts: ColumnFiltersOptions = {}) => {
  const guard = sliceGuard('columnFilters', fixSlice)
  return defineFeature<'columnFilters', ColumnFiltersTypes>({
    name: 'columnFilters',
    stage: 'filter',
    mode: opts.mode ?? 'client',
    options: defineOptions(
      // The option validator runs in development only (§9.3): production drops the schema.
      DEV ? columnFiltersOptions : ({} as typeof columnFiltersOptions),
      opts,
    ),
    interceptors: [guard.interceptor],
    initialState: () => ({}),
    createApi: (ctx) => {
      guard.install(ctx)
      // Values, not updaters: a library step is never reported as a failing user `updater` (#89).
      // A controlled slice not fed back yet may still be malformed: it reads as no filters.
      const current = (): Record<string, unknown> => {
        const s = ctx.getState()
        return isSlice(s) ? s : {}
      }
      return {
        setColumnFilter: (id, filter) => {
          // `next[id] =` would swap the slice's prototype (#102); never a column id.
          if (id === PROTO_KEY) {
            ctx.emit('DK_STATE_UNKNOWN_KEY', { slice: 'columnFilters', key: id, known: [] })
            return
          }
          const prev = current()
          // No change (the same filter, or clearing a column without one): keep the slice.
          if ((Object.hasOwn(prev, id) ? prev[id] : undefined) === filter) return
          const next: Record<string, unknown> = { ...prev }
          if (filter === undefined) delete next[id]
          else next[id] = filter
          ctx.setState(next as ColumnFiltersState<unknown>)
        },
        resetColumnFilters: () => {
          const s = ctx.getState()
          if (!isSlice(s) || Object.keys(s).length > 0) ctx.setState({})
        },
      }
    },
    rowModel: filterRows,
  })
}
