import type { InvalidRowsMode } from '../ingest/schema-codes'
import type { FlaggedRow, Row } from './row'

/**
 * `getRowModel().status` (§6.6). Any diagnostic that affects the row model sets `'error'`; the last
 * good row model is shown meanwhile. `'searching'` is an async `searchFn` in flight, `'fetching'` a
 * `fetcher` request. Every change produces a new row model and notifies subscribers.
 */
export type RowModelStatus = 'idle' | 'validating' | 'pending' | 'searching' | 'fetching' | 'error'

/** The row type of `getRowModel().rows`: a {@link FlaggedRow} union under `invalidRows: 'flag'`. */
export type RowOf<T, M extends InvalidRowsMode = 'drop'> = [M] extends ['flag']
  ? FlaggedRow<T>
  : Row<T>

/** What `table.getRowModel()` returns (§6.6). The same object until the row model changes. */
export interface RowModel<T, M extends InvalidRowsMode = 'drop'> {
  /** The visible rows only (the current page when paginated). */
  readonly rows: readonly RowOf<T, M>[]
  /** Rows left after filter and search (before pagination). */
  readonly filteredCount: number
  /** Rows after ingest. */
  readonly totalCount: number
  readonly status: RowModelStatus
  /**
   * `true` until the table has had rows to show for the first time (data given at creation, or the
   * first data / result applied; an empty result counts). Never goes back to `true`.
   */
  readonly isInitialLoad: boolean
}

/** Column values from the column cache, indexed by row index (§9.1). */
export type ColumnValues = Float64Array | readonly unknown[]
