import type { Row } from './row'

/**
 * `getRowModel().status` (§6.6). Any diagnostic that affects the row model sets `'error'`; the last
 * good row model is shown meanwhile. `'searching'` is an async `searchFn` in flight, `'fetching'` a
 * `fetcher` request. Every change produces a new row model and notifies subscribers.
 */
export type RowModelStatus = 'idle' | 'validating' | 'pending' | 'searching' | 'fetching' | 'error'

/** What `table.getRowModel()` returns (§6.6). The same object until the row model changes. */
export interface RowModel<T> {
  /** The visible rows only (the current page when paginated). */
  readonly rows: readonly Row<T>[]
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
