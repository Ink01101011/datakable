import { describeReturn, expectedReturn, formatSlot, slotDiagnostics } from '../catalog/slots'
import { defaultFormat } from '../column/format'
import { getValue } from '../column/get-value'
import { DEV } from '../diagnostics/env'
import type { Emit } from '../diagnostics/types'
import { CellFailures, type CellSlot, runCells } from '../intercept/cell-batch'
import { type ContextBase, createContextPool } from '../intercept/context'
import type { InterceptorRuntime } from '../intercept/runtime'
import { pipelineDiagnostics } from './codes'
import type { ColumnLike, ResolvedColumn } from './columns'
import { allRows } from './indices'
import type { ColumnValues } from './types'

void pipelineDiagnostics
void slotDiagnostics

export interface ColumnCacheHost {
  readonly runtime: InterceptorRuntime
  readonly emit: Emit
  base(): ContextBase
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
}

const NULL = 1
const UNDEFINED = 2

const typeName = (v: unknown) => (Array.isArray(v) ? 'array' : typeof v)

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
  const unrenderable = new CellFailures()
  /** Dev: `format` returns that broke the slot contract (`first` = the first bad value). */
  const badReturns = new CellFailures()

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
          unrenderable.reset()
          badReturns.reset()
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
    return out
  }

  function values(data: readonly unknown[], column: ResolvedColumn): ColumnValues {
    const e = entry(data, column)
    e.values ??= readValues(data, column, e)
    return e.values
  }

  function formatted(data: readonly unknown[], column: ResolvedColumn): readonly string[] {
    const e = entry(data, column)
    if (e.formatted) return e.formatted
    const vals = values(data, column)
    const kinds = e.nullish
    // The raw value: nullish numbers read back as null / undefined, not NaN.
    const valueAt = (r: number): unknown => {
      const k = kinds?.[r]
      return k ? (k === NULL ? null : undefined) : vals[r]
    }
    const n = data.length
    const rows = allRows(data)
    const out: string[] = new Array(n).fill('')
    const format = column.format
    batch(column, 'format', 'format', rows, () => {
      if (format) {
        let firstBad: unknown
        runCells(
          rows,
          (r) => {
            const s = format(valueAt(r))
            if (typeof s === 'string') return s
            // Slot contract (dev): counted only on this non-string path; coerced either way.
            if (DEV) {
              if (badReturns.count === 0) firstBad = s
              badReturns.add(r, undefined)
            }
            return defaultFormat(s)
          },
          out,
          '',
          failures,
        )
        failures.report(host.emit, column.index, column.id, 'format')
        if (DEV && badReturns.count > 0) {
          host.emit('DK_CALLBACK_BAD_RETURN', {
            slot: `columns[${column.index}].format`,
            column: column.id,
            expected: expectedReturn(formatSlot),
            received: describeReturn(firstBad),
            count: badReturns.count,
            rows: Array.from(badReturns.sample()),
            fallback: formatSlot.fallback,
          })
        }
        return
      }
      let cur = 0
      let firstType = ''
      // A column with `cell` renders itself: its formatted value only feeds search.
      const onUnrenderable = column.hasCell
        ? undefined
        : (v: unknown) => {
            if (unrenderable.count === 0) firstType = typeName(v)
            unrenderable.add(cur, undefined)
          }
      runCells(
        rows,
        (r) => {
          cur = r
          return defaultFormat(valueAt(r), onUnrenderable)
        },
        out,
        '',
        failures,
      )
      failures.report(host.emit, column.index, column.id, 'format')
      if (unrenderable.count > 0) {
        host.emit('DK_UNRENDERABLE_VALUE', {
          column: column.id,
          index: column.index,
          count: unrenderable.count,
          rows: Array.from(unrenderable.sample()),
          valueType: firstType,
        })
      }
    })
    e.formatted = out
    return out
  }

  return { values, formatted, batch }
}
