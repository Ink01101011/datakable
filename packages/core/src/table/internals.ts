import type { AnyFeature } from '../feature/types'
import type { AsyncStatus } from '../source/async-control'

/**
 * Internal seam for core modules that run async work through a table (search T19, fetcher T21).
 * Not exported from the package: `createTable` registers each table here.
 */
export interface TableInternals {
  /**
   * The installed features in pipeline order (`orderFeatures`: by stage, stable). Fixed at
   * creation; the pipeline runner (T09) runs their `rowModel`s in this order.
   */
  readonly features: readonly AnyFeature[]
  /**
   * The server row count (§6.5, §7.1): the last applied fetcher result's `rowCount` with a fetcher
   * (`undefined` until one applied), else `options.rowCount`.
   */
  rowCount(): number | undefined
  /** `options.fetcher` is set. */
  hasFetcher(): boolean
  /**
   * Runs one `async:request` through the table's interceptor chain (errorBoundary → asyncControl
   * → …), with `previous` as FALLBACK. Resolves with the outcome; apply `value` only when
   * `status === 'applied'`. Never rejects, except under `strict` (a `DatakableError`).
   */
  request(
    source: 'fetcher' | 'searchFn',
    core: (signal: AbortSignal) => Promise<unknown>,
    opts?: {
      previous?: unknown
      params?: unknown
      signal?: AbortSignal
      /**
       * Applies the outcome before the in-flight status is cleared, in one batch: the status
       * change and the applied result are one notification. Called on every outcome.
       */
      onSettle?: (value: unknown, status: AsyncStatus) => void
    },
  ): Promise<{ value: unknown; status: AsyncStatus }>
}

const registry = new WeakMap<object, TableInternals>()

export function setTableInternals(table: object, internals: TableInternals): void {
  registry.set(table, internals)
}

export function getTableInternals(table: object): TableInternals {
  const i = registry.get(table)
  if (!i) throw new TypeError('getTableInternals: not a table made by createTable()')
  return i
}
