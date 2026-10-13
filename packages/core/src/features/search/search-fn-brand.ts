import type { FeatureContext, RowModelContext } from '../../feature/types'
import type { RowKey } from '../../pipeline/row'

/** What `setSearch` / `flushSearch` resolve to; they never reject. */
export interface SearchOutcome {
  status: 'applied' | 'superseded' | 'error'
}

/**
 * `state.search.status` (§6.3): `'pending'` = a debounce is waiting (T17), `'searching'` = an async
 * `searchFn` is in flight (T19), `'error'` = it failed (previous results kept).
 */
export type SearchStatus = 'idle' | 'pending' | 'searching' | 'error'

/** The `search` slice (§6.3). */
export interface SearchState {
  /** What the user typed; updates immediately. */
  input: string
  /** The applied query (what the row model reflects). */
  query: string
  status: SearchStatus
  /** The last `searchFn` failure, when `status` is `'error'`. */
  error?: unknown
}

/** What `searchFn` receives (§6.3). */
export interface SearchFnContext<T> {
  /** The applied query, trimmed (never blank: a blank query shows every row without a call). */
  query: string
  /** The ingested rows (`table.getData()`); the result is intersected with the filtered ones. */
  rows: readonly T[]
  /** `options.columns` (empty when not given). */
  columns: readonly unknown[]
  /** Aborted when the request is superseded, cancelled, timed out or the table is destroyed. */
  signal: AbortSignal
}

/**
 * A `searchFn` result: the matching rows (references from `ctx.rows`) in relevance order, or their
 * row keys (`rowKey` values; row indices without a `rowKey`).
 */
export type SearchResult<T> = readonly T[] | { keys: readonly RowKey[] }

/** Custom / remote matching (§6.3). Runs through `async:request`: latest wins, abort, `timeout`. */
export type SearchFn<T> = (
  ctx: SearchFnContext<T>,
) => SearchResult<T> | PromiseLike<SearchResult<T>>

/** What `setSearch` / `flushSearch` wait on. */
export interface Waiter {
  query: string
  resolve: (o: SearchOutcome) => void
}

export const APPLIED: SearchOutcome = Object.freeze({ status: 'applied' })
export const SUPERSEDED: SearchOutcome = Object.freeze({ status: 'superseded' })

/** The `search` feature's side of a table, handed to the async engine. */
export interface SearchHost {
  ctx: FeatureContext<SearchState>
  write(input: string, query: string, status: SearchStatus, error?: unknown): void
  applied(): string
  input(): string
  /** Takes the waiters of `query`; every other waiting one resolves `'superseded'`. */
  claim(query: string): Waiter[]
}

/** The async engine's per-table half. */
export interface SearchSession {
  /** Applies `query` through `searchFn`; `false` when the feature applies it at once. */
  apply(query: string, input: string): boolean
  /** A search is in flight. */
  busy(): boolean
  /** Aborts the in-flight search (its waiters: `'superseded'`). */
  abort(): void
  destroy(): void
}

/** The async search engine (`withSearchFn`): `searchFn` requests and their applied results. */
export interface SearchEngine {
  /** The row model step while a query is applied: the input rows in the applied result. */
  step(input: Uint32Array, ctx: RowModelContext): Uint32Array
  /** Around `pipeline:run`: the step reads this table's result; new data searches again. */
  run<R>(table: object, next: () => R): R
  session(host: SearchHost): SearchSession
}

/** Key of the engine a {@link AsyncSearchFn} carries (§6.3). Registered: copies agree. */
export const SEARCH_ENGINE: unique symbol = Symbol.for('datakable.searchEngine') as never

/**
 * A `searchFn` opted into the async search engine with `withSearchFn()` from
 * `@datakable/core/search-async` (§6.3, changed 2026-10-13 for §9.3): `search({ searchFn })` takes
 * only these, so client search never bundles the request machinery.
 */
export type AsyncSearchFn<T> = SearchFn<T> & {
  readonly [SEARCH_ENGINE]: (fn: SearchFn<unknown>) => SearchEngine
}
