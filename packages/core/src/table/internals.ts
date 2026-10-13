import type { DiagnosticCode, DiagnosticDetails } from '../diagnostics/catalog'
import type { Emit, EmitOptions, Trigger } from '../diagnostics/types'
import type { AnyFeature } from '../feature/types'
import type { ContextBase } from '../intercept/context'
import type { Interceptor } from '../intercept/define'
import type { OpName } from '../intercept/operations'
import type { InterceptorRuntime } from '../intercept/runtime'
import type { RowModelStatus } from '../pipeline/types'
import type { Table, TableOptions, TableState } from './types'

/**
 * What a table extension sees of its table (`TableInternals.use`). Extensions are the opt-in parts
 * of the store that a bare table does not bundle (changed 2026-10-13 for §9.3): the async request
 * machinery (`source/requests.ts`, for `searchFn` and the fetcher) and the server source
 * (`source/server.ts`, `withFetcher`). Not public API.
 */
export interface TableHost {
  readonly table: Table<unknown, TableState>
  /** `options.name`, else `table#n` (diagnostic context, config errors). */
  readonly name: string
  readonly emit: Emit
  /** The interceptor runtime of the table (ops run through it with the errorBoundary outermost). */
  readonly runtime: InterceptorRuntime
  /** The installed features in pipeline order. */
  readonly features: readonly AnyFeature[]
  options(): TableOptions<unknown>
  state(): TableState
  /** Context values of a new op ctx (table, run, trigger, phase, emit). */
  base(): ContextBase
  destroyed(): boolean
  /** Data given by the user or a fetcher has been applied once (`isInitialLoad` is `false`). */
  loaded(): boolean
  /** The table's status (§6.6), every source included. */
  status(): RowModelStatus
  /** A row model change not caused by state: recomputed and notified on the next flush. */
  touch(): void
  /** Notifies listeners now, unless an API call or batch is in progress (it notifies at its end). */
  notify(): void
  /** Runs `fn` under trigger `t` as one batch: listeners are notified once, when it returns. */
  batch<R>(t: Trigger, fn: () => R): R
  /** Ingests rows a fetcher returned through `data:ingest` (schema, data checks; marks loaded). */
  ingest(rows: readonly unknown[]): void
  /** Installs `interceptor` first in the chain (inside the errorBoundary), e.g. asyncControl. */
  intercept(interceptor: Interceptor<OpName>): void
  /** The table was created inside `createDeferred` and `startTable` has not run yet (§7.2). */
  deferring(): boolean
  /** Another extension of the same table (`TableInternals.use`). */
  use<E extends TableExtension>(factory: ExtensionFactory<E>): E
}

/** Hooks a table extension may implement. */
export interface TableExtension {
  /** Its contribution to `RowModel.status` (§6.6 precedence), or `undefined`. */
  status?(): RowModelStatus | undefined
  /** Before each notification round: start work that follows state (the fetcher, §7.1). */
  sync?(): void
  /** `startTable` (§7.2): starts deferred work; `true` when something was waiting. */
  start?(): boolean
  /** Every async source deferred since creation (`createDeferred`, `DK_SSR_ASYNC_DEFERRED`). */
  deferred?(): readonly ('fetcher' | 'searchFn')[]
}

/** Creates one table's extension; `use` calls it once per table. */
export type ExtensionFactory<E extends TableExtension> = (host: TableHost) => E

/**
 * Internal seam for core modules that work through a table (search T19, fetcher T21, pagination,
 * SSR). Not exported from the package: `createTable` registers each table here.
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
   * The ingested `options.initialData` while it is still the table's data (§7.2): the result of
   * the initial async work. `undefined` without it, or once other data was applied.
   */
  initialRows(): readonly unknown[] | undefined
  /** The table's extension made by `factory`, created on first use. */
  use<E extends TableExtension>(factory: ExtensionFactory<E>): E
  /** The table's extension made by `factory`, if it was created. */
  peek<E extends TableExtension>(factory: ExtensionFactory<E>): E | undefined
  /** The extensions created so far (SSR reads their deferred sources without importing them). */
  extensions(): Iterable<TableExtension>
  /** Starts the deferred work (`startTable`); a no-op when not deferred. */
  start(): void
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
