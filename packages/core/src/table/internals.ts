import type { DiagnosticCode, DiagnosticDetails } from '../diagnostics/catalog'
import type { Emit, EmitOptions } from '../diagnostics/types'
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
  /** The table's diagnostics hub emit (`emitTableDiagnostic`). */
  readonly emit: Emit
  /**
   * SSR (§7.2, `createDeferred`): `true` while the table waits for `startTable`; `source` is then
   * recorded as deferred work (`status: 'pending'`) and must not start. `false` once started.
   */
  defer(source: 'fetcher' | 'searchFn'): boolean
  /** The sources deferred since creation (`DK_SSR_ASYNC_DEFERRED`). */
  deferred(): readonly ('fetcher' | 'searchFn')[]
  /** Starts the deferred work (`startTable`); a no-op when not deferred. */
  start(): void
  /**
   * The ingested `options.initialData` while it is still the table's data (§7.2): the result of
   * the initial async work. `undefined` without it, or once other data was applied.
   */
  initialRows(): readonly unknown[] | undefined
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

/**
 * Reports a catalog diagnostic on `table`'s hub (its sinks, `onDiagnostic`, `getDiagnostics()`), for
 * bindings that detect problems outside the table, e.g. `@datakable/react`'s unstable-columns warning.
 * The code must be defined with `defineDiagnostic`.
 */
export function emitTableDiagnostic<C extends DiagnosticCode>(
  table: object,
  code: C,
  details: DiagnosticDetails<C>,
  options?: EmitOptions,
): void {
  getTableInternals(table).emit(code, details, options)
}

/**
 * `createDeferred` (ssr.ts) nesting depth: a table created while it is > 0 defers its async work
 * until `startTable` (§7.2). Kept here so `createTable` does not import the SSR module.
 */
export const deferral = { depth: 0 }
