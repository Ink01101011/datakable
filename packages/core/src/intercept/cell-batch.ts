import { keepDiagnostics } from '../diagnostics/catalog'
import type { Emit, EmitOptions } from '../diagnostics/types'
import { errorName } from './classify'
import { boundaryDiagnostics } from './codes'

// CellFailures emits DK_CALLBACK_FAILED: keep its definition wherever this module is bundled (a
// feature entry alone brings the feature runtime, and with it the column cache, #5).
keepDiagnostics(boundaryDiagnostics)

/** The cell slots of `column:batch`. */
export type CellSlot = 'accessor' | 'format' | 'filterFn' | 'sortBy'

/**
 * Per failed cell (§3.4): `''` (format) / `undefined` (accessor) / non-matching (filter fn) /
 * `undefined`, sorted last as a missing value (sortBy).
 */
export const CELL_FALLBACK = {
  accessor: undefined,
  format: '',
  filterFn: false,
  sortBy: undefined,
} as const

const CELL_FALLBACK_TEXT: Record<CellSlot, string> = {
  accessor: 'the failed cells read as undefined',
  format: "the failed cells render ''",
  filterFn: 'the failed rows are treated as non-matching',
  sortBy: 'the failed rows sort as missing values (last)',
}

/**
 * Failures of one column's cells in one pipeline run, recorded as numbers (§3.4): a count, the
 * first `sample` row indices and the first error. No per-cell allocation; `where` and text are
 * built only in {@link CellFailures.report}. Reuse one instance per column across runs.
 */
export class CellFailures {
  count = 0
  private first: unknown
  private readonly rows: Uint32Array

  constructor(sample = 5) {
    this.rows = new Uint32Array(sample)
  }

  add(row: number, error: unknown): void {
    if (this.count === 0) this.first = error
    if (this.count < this.rows.length) this.rows[this.count] = row
    this.count++
  }

  /** The recorded sample of failing row indices (a view; valid until the next reset). */
  sample(): Uint32Array {
    return this.rows.subarray(0, Math.min(this.count, this.rows.length))
  }

  reset(): void {
    this.count = 0
    this.first = undefined
  }

  /**
   * Emits one `DK_CALLBACK_FAILED` for this column (if any cell failed), then resets. `where` is the
   * slot path `columns[<index>].<slot>`; `field` replaces the slot name in that path when the
   * failing column field differs (`key` for a key column whose getter threw).
   */
  report(
    emit: Emit,
    columnIndex: number,
    columnId: string,
    slot: CellSlot,
    options?: EmitOptions,
    field: string = slot,
  ): void {
    if (this.count === 0) return
    const name = errorName(this.first)
    emit(
      'DK_CALLBACK_FAILED',
      {
        slot: `columns[${columnIndex}].${field}`,
        column: columnId,
        rows: Array.from(this.sample()),
        count: this.count,
        fallback: CELL_FALLBACK_TEXT[slot],
        ...(name === undefined ? {} : { errorName: name }),
      },
      { ...options, cause: this.first },
    )
    this.reset()
  }
}

/**
 * The body of a `column:batch`: runs `cell` for each row in `rows` and writes `out[row]`. A throwing
 * cell gets `fallback` and is recorded in `failures` — the loop never throws per cell and never
 * dispatches an interceptor per cell. Call `failures.report(...)` once after the loop.
 */
export function runCells<R>(
  rows: Uint32Array,
  cell: (row: number) => R,
  out: { [row: number]: R },
  fallback: R,
  failures: CellFailures,
): void {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as number
    try {
      out[row] = cell(row)
    } catch (e) {
      out[row] = fallback
      failures.add(row, e)
    }
  }
}
