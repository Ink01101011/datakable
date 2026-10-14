import { describeReturn, expectedReturn, formatSlot, slotDiagnostics } from '../catalog/slots'
import { defaultFormat } from '../column/format'
import { getValue } from '../column/get-value'
import { keepDiagnostics } from '../diagnostics/catalog'
import { DEV } from '../diagnostics/env'
import type { Emit } from '../diagnostics/types'
import { CellFailures, type CellSlot, runCells } from '../intercept/cell-batch'
import { type ContextBase, createContextPool } from '../intercept/context'
import type { InterceptorRuntime } from '../intercept/runtime'
import { pipelineDiagnostics } from './codes'
import type { ColumnLike, ResolvedColumn } from './columns'
import { allRows } from './indices'
import { runJob } from './slice'
import type { ColumnValues } from './types'

keepDiagnostics(pipelineDiagnostics, slotDiagnostics)

export interface ColumnCacheHost {
  readonly runtime: InterceptorRuntime
  readonly emit: Emit
  base(): ContextBase
  /**
   * The §6.6 status rule's counter (pipeline/status-rule.ts): `emit` increments it for a diagnostic
   * the rule counts. An entry whose read incremented it is flagged, and every later read of that
   * entry increments it again (its cells still hold the fallback values).
   */
  readonly flags?: { count: number }
}

/**
 * Internal member of the pipeline's run context (not on the public `RowModelContext`): a column's
 * formatted values as a time-sliced job (search, #40); `undefined` for an unknown column.
 */
export interface SlicedFormatting {
  readonly formattedSliced?: (
    id: string,
  ) => Generator<undefined, readonly string[] | undefined, undefined>
}

export interface ColumnCache {
  /**
   * The values of `column` for every row of `data` (index = row index). An all-number column is a
   * `Float64Array` with `NaN` for `null` / `undefined`; any other column a plain array.
   */
  values(data: readonly unknown[], column: ResolvedColumn): ColumnValues
  /** `format` (or the default formatter) applied to {@link values}: what the user sees. */
  formatted(data: readonly unknown[], column: ResolvedColumn): readonly string[]
  /**
   * {@link formatted} as a time-sliced job (§9.1, #40): the cells are formatted in batches of a few
   * milliseconds with a `yield` between them (one `column:batch` per batch, never per cell).
   */
  formattedSliced(
    data: readonly unknown[],
    column: ResolvedColumn,
  ): Generator<undefined, readonly string[], undefined>
  /**
   * Runs `body` as one `column:batch` over `rows` (pooled ctx, `where` = `columns[i].<field>`):
   * interceptors see one dispatch per column, never one per cell. `body` loops over the cells
   * with an inline `try/catch` and reports its own failures.
   */
  batch(
    column: ResolvedColumn,
    slot: CellSlot,
    field: string,
    rows: Uint32Array,
    body: () => void,
  ): void
}

interface Entry {
  values?: ColumnValues
  /** Numeric columns: 1 = `null`, 2 = `undefined` per row. Absent when there are none. */
  nullish?: Uint8Array | undefined
  formatted?: readonly string[]
  /** Reading `values` / `formatted` reported a diagnostic the status rule counts. */
  flaggedValues?: boolean
  flaggedFormatted?: boolean
}

const NULL = 1
const UNDEFINED = 2

/** The nullish kinds of each cached numeric column that has any (see {@link nullishOf}). */
const nullishKinds = new WeakMap<Float64Array, Uint8Array>()

/**
 * Which rows of a cached all-number column (`values` from the column cache) hold `null` /
 * `undefined` (non-zero) rather than a real `NaN`: both are stored as `NaN`. `undefined` when no
 * row does. Lets search format such a column on the fly (`''` / `'NaN'`) instead of caching a
 * string per row (#27).
 */
export function nullishOf(values: Float64Array): Uint8Array | undefined {
  return nullishKinds.get(values)
}

function allStrings(values: readonly unknown[]): boolean {
  for (let i = 0; i < values.length; i++) if (typeof values[i] !== 'string') return false
  return true
}

const typeName = (v: unknown) => (Array.isArray(v) ? 'array' : typeof v)

/** Rows per batch of a sliced format (#40): small, so the slicer's clock check comes often. */
const STEP = 512

/** Distinct strings {@link share} remembers per column: enough for categories, tags, flags. */
const SHARED = 1024

/**
 * Repeated formatted strings of a column share one copy (§9.3 memory, #27): each formatted cell is
 * a fresh string, so a column of tags or categories would keep one per row. Only the first
 * {@link SHARED} distinct strings are remembered; once per column, after formatting.
 */
function share(cells: string[]) {
  const seen = new Map<string, string>()
  for (let r = 0; r < cells.length; r++) {
    const s = cells[r] as string
    const hit = seen.get(s)
    if (hit !== undefined) cells[r] = hit
    else if (seen.size < SHARED) seen.set(s, s)
  }
}

/**
 * The lazy column cache (§9.1): a column is read only when a step asks for it, once per data
 * reference, in one `column:batch` per column (never per cell, §3.4). Entries live in a `WeakMap`
 * keyed by the data reference, then by the column definition, so new data or a changed column
 * releases them.
 */
export function createColumnCache(host: ColumnCacheHost): ColumnCache {
  const byData = new WeakMap<readonly unknown[], WeakMap<ColumnLike, Entry>>()
  const pool = createContextPool()
  const failures = new CellFailures()

  function entry(data: readonly unknown[], column: ResolvedColumn): Entry {
    let cols = byData.get(data)
    if (!cols) {
      cols = new WeakMap()
      byData.set(data, cols)
    }
    let e = cols.get(column.def)
    if (!e) {
      e = {}
      cols.set(column.def, e)
    }
    return e
  }

  /** One `column:batch` (pooled ctx); `where` = `columns[i].<field>`, never row data. */
  function batch(
    column: ResolvedColumn,
    slot: CellSlot,
    field: string,
    rows: Uint32Array,
    body: () => void,
  ) {
    const ctx = pool.acquire(
      'column:batch',
      { column: column.id, slot, rows },
      `columns[${column.index}].${field}`,
      host.base(),
    )
    try {
      void host.runtime.run('column:batch', ctx, (): undefined => {
        try {
          body()
        } finally {
          failures.reset()
        }
      })
    } finally {
      pool.release(ctx)
    }
  }

  function readValues(data: readonly unknown[], column: ResolvedColumn, e: Entry): ColumnValues {
    const n = data.length
    const rows = allRows(data)
    const out: unknown[] = new Array(n).fill(undefined)
    const field = column.path ? 'key' : 'accessor'
    batch(column, 'accessor', field, rows, () => {
      const path = column.path
      const accessor = column.accessor
      if (path) {
        let cur = 0
        const onError = (error: unknown) => failures.add(cur, error)
        runCells(
          rows,
          (r) => {
            cur = r
            return getValue(data[r], path, onError)
          },
          out,
          undefined,
          failures,
        )
      } else if (accessor) {
        runCells(rows, (r) => accessor(data[r]), out, undefined, failures)
      }
      failures.report(host.emit, column.index, column.id, 'accessor', undefined, field)
    })
    return toNumeric(out, e) ?? out
  }

  /** A `Float64Array` when every non-nullish value is a number (and there is one); else nothing. */
  function toNumeric(values: unknown[], e: Entry): Float64Array | undefined {
    let numbers = 0
    let nullish = 0
    for (let i = 0; i < values.length; i++) {
      const v = values[i]
      if (typeof v === 'number') numbers++
      else if (v === null || v === undefined) nullish++
      else return undefined
    }
    if (numbers === 0) return undefined
    const out = new Float64Array(values.length)
    const kinds = nullish > 0 ? new Uint8Array(values.length) : undefined
    for (let i = 0; i < values.length; i++) {
      const v = values[i]
      if (typeof v === 'number') out[i] = v
      else {
        out[i] = Number.NaN
        if (kinds) kinds[i] = v === null ? NULL : UNDEFINED
      }
    }
    e.nullish = kinds
    if (kinds) nullishKinds.set(out, kinds)
    return out
  }

  const flags = host.flags

  function values(data: readonly unknown[], column: ResolvedColumn): ColumnValues {
    const e = entry(data, column)
    if (e.values) {
      if (flags && e.flaggedValues) flags.count++
      return e.values
    }
    const before = flags?.count ?? 0
    e.values = readValues(data, column, e)
    if (flags && flags.count > before) e.flaggedValues = true
    return e.values
  }

  /**
   * Formats `column` once per data reference, in one `column:batch`; `sliced` (#40): in batches of
   * {@link STEP} rows with a `yield` between them, so the slicer can end the task on time (a slow
   * formatter, e.g. dates, is never one long task). Failures and slot-contract breaks are counted
   * over the whole column and reported once.
   */
  function* formatting(
    data: readonly unknown[],
    column: ResolvedColumn,
    sliced: boolean,
  ): Generator<undefined, readonly string[], undefined> {
    let e = entry(data, column)
    if (e.formatted) {
      if (flags && e.flaggedFormatted) flags.count++
      return e.formatted
    }
    const before = flags?.count ?? 0
    const vals = values(data, column)
    if (sliced) yield // reading the values is a task of its own
    const kinds = e.nullish
    // The raw value: nullish numbers read back as null / undefined, not NaN.
    const valueAt = (r: number): unknown => {
      const k = kinds?.[r]
      return k ? (k === NULL ? null : undefined) : vals[r]
    }
    const n = data.length
    const rows = allRows(data)
    const format = column.format
    // Job-local counts: a sliced column spans several batches.
    const failed = new CellFailures()
    const bad = DEV ? new CellFailures() : undefined
    const unrendered = new CellFailures()
    let firstBad: unknown
    let firstType = ''
    let cur = 0
    // A column with `cell` renders itself: its formatted value only feeds search.
    const onUnrenderable = column.hasCell
      ? undefined
      : (v: unknown) => {
          if (unrendered.count === 0) firstType = typeName(v)
          unrendered.add(cur, undefined)
        }
    const cell = format
      ? (r: number) => {
          const s = format(valueAt(r))
          if (typeof s === 'string') return s
          // Slot contract (dev): counted only on this non-string path; coerced either way.
          if (DEV && bad) {
            if (bad.count === 0) firstBad = s
            bad.add(r, undefined)
          }
          return defaultFormat(s)
        }
      : (r: number) => {
          cur = r
          return defaultFormat(valueAt(r), onUnrenderable)
        }
    // Values that are all strings already format to themselves: no copy (§9.3 memory).
    const strings = !format && !(vals instanceof Float64Array) && allStrings(vals)
    let out: string[] | undefined = strings ? undefined : new Array(n).fill('')
    for (let from = 0; from < n; from += STEP) {
      const part = sliced && !strings ? rows.subarray(from, from + STEP) : rows
      // An interceptor may skip a batch: its cells keep the slot fallback ('').
      batch(column, 'format', 'format', part, () => {
        if (strings) out = vals as string[]
        else runCells(part, cell, out as string[], '', failed)
      })
      if (part === rows || from + STEP >= n) break
      yield
    }
    out ??= new Array<string>(n).fill('')
    failed.report(host.emit, column.index, column.id, 'format')
    if (DEV && bad && bad.count > 0) {
      host.emit('DK_CALLBACK_BAD_RETURN', {
        slot: `columns[${column.index}].format`,
        column: column.id,
        expected: expectedReturn(formatSlot),
        received: describeReturn(firstBad),
        count: bad.count,
        rows: Array.from(bad.sample()),
        fallback: formatSlot.fallback,
      })
    }
    if (unrendered.count > 0) {
      host.emit('DK_UNRENDERABLE_VALUE', {
        column: column.id,
        index: column.index,
        count: unrendered.count,
        rows: Array.from(unrendered.sample()),
        valueType: firstType,
      })
    }
    if (out !== vals) share(out)
    // A synchronous read may have cached the column while a sliced job ran.
    e = entry(data, column)
    if (!e.formatted) {
      e.formatted = out
      if (flags && flags.count > before) e.flaggedFormatted = true
    }
    return e.formatted
  }

  function formatted(data: readonly unknown[], column: ResolvedColumn): readonly string[] {
    return runJob(() => formatting(data, column, false))
  }

  return {
    values,
    formatted,
    formattedSliced: (data, column) => formatting(data, column, true),
    batch,
  }
}
