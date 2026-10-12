import type { ColumnDef, LooseRow, Path } from '../column'
import type { RedactFn, RedactLevel } from '../diagnostics/redact'
import type { Diagnostic } from '../diagnostics/types'
import type { AnyFeature } from '../feature/types'
import type { InvalidRow } from '../ingest/schema'
import type { InvalidRowsMode } from '../ingest/schema-codes'
import type { StandardSchemaV1 } from '../ingest/standard-schema'
import type { Interceptor } from '../intercept/define'
import type { OpName } from '../intercept/operations'
import type { RowModel } from '../pipeline/types'

/** Table state: one entry per slice (feature state is typed by `StateOf`, T08). */
export type TableState = Record<string, unknown>

/** A partial state merged per slice, or a function of the current state returning one. */
export type Updater<S> = Partial<S> | ((prev: S) => Partial<S>)

/** `options.state`: a slice given as `undefined` counts as not passed (owned by the store). */
export type ControlledState<S> = { [K in keyof S]?: S[K] | undefined }

/** Called after each committed change with the new and the previously notified snapshot. */
export type Listener<S> = (state: S, prev: S) => void

/**
 * Max consecutive re-entrant notification rounds (a listener updating state, whose listeners
 * update state, …). The update that would start the next round is dropped (`DK_UPDATE_LOOP`).
 */
export const UPDATE_DEPTH_LIMIT = 50

export interface TableDiagnosticsOptions {
  /**
   * Redaction (§8.2): a level, or a custom `redact(path, value)` on top of the default level
   * (`'keys'` in development, `'safe'` in production). Columns with `sensitive: true` are never
   * logged; a sensitive `rowKey` column is hashed at every level.
   */
  redact?: RedactLevel | RedactFn
}

export interface TableOptions<T, S extends TableState = TableState> {
  /** Names the table in diagnostics; default `table#n`. */
  name?: string
  data?: readonly T[]
  columns?: readonly ColumnDef<T>[]
  /**
   * A Standard Schema v1 (zod, valibot, arktype, …) every row is validated with (§5.1); the row
   * type is its output. An async schema sets `status: 'validating'` while it runs. Read once, at
   * creation.
   */
  schema?: StandardSchemaV1<unknown, T>
  /**
   * What happens to rows that fail `schema` (§5.1): `'drop'` (default) removes them, `'flag'` keeps
   * them with `row.valid === false`, `'throw'` throws `DatakableSchemaError`. All three list them in
   * `getInvalidRows()`. Read once, at creation; no effect without `schema`.
   */
  invalidRows?: InvalidRowsMode
  /** Row identity (§5.2). Read by redaction here; key handling is the ingest's. */
  rowKey?: Path<LooseRow<T>> | ((row: T) => string | number)
  /**
   * Installed features (§3.3), in any order: the pipeline runs them by `stage`. Each adds its state
   * slice and merges its API onto the table. Read once, at creation (`setOptions` ignores it).
   */
  features?: readonly AnyFeature[]
  /** Starting values of owned slices; a feature slice given here replaces its `initialState()`. */
  initialState?: Partial<S>
  /**
   * Controlled slices (§3.2): every key with a defined value is owned by the caller, who feeds
   * changes back through `setOptions({ state })`. Slices not passed are owned by the store.
   */
  state?: ControlledState<S>
  /**
   * Receives changes to controlled slices as an updater that merges only the changed slices into
   * the caller's state: `onStateChange: (u) => setControlled(u)`. Not called for owned slices.
   */
  onStateChange?: (updater: (prev: Partial<S>) => Partial<S>) => void
  /** User / feature interceptors (§3.4). The errorBoundary is always installed outermost. */
  interceptors?: readonly Interceptor<OpName>[]
  /** User sink for every diagnostic (e.g. Sentry). */
  onDiagnostic?: (d: Diagnostic) => void
  /**
   * ms before an async request (`fetcher`, `searchFn`) is aborted with `DK_ASYNC_TIMEOUT`.
   * Default 30 000; `Infinity` disables it. Read once, at creation.
   */
  timeout?: number
  /** Rethrow error-level diagnostics as `DatakableError`. */
  strict?: boolean
  diagnostics?: TableDiagnosticsOptions
}

export interface Table<
  T,
  S extends TableState = TableState,
  M extends InvalidRowsMode = 'drop',
  /** The element type `setOptions({ data })` accepts: `unknown` (raw input) with a schema. */
  In = T,
> {
  /** The current immutable snapshot; the same reference until a slice changes. */
  getState(): S
  setState(updater: Updater<S>): void
  /** Returns the unsubscribe function. One throwing listener never stops the others. */
  subscribe(listener: Listener<S>): () => void
  /** Merges `options` into the current ones (`table:setOptions`). */
  setOptions(
    options: Partial<Omit<TableOptions<T, S>, 'features' | 'data'>> & { data?: readonly In[] },
  ): void
  getOptions(): Readonly<TableOptions<T, S>>
  /** The ingested data (the previous data while an async ingest is pending or failed). */
  getData(): readonly T[]
  /**
   * The row model (§6.6): the visible rows (`Row` objects for the current page only), the counts
   * and the status. The same object until data, state or columns change the result.
   */
  getRowModel(): RowModel<T, M>
  /**
   * The rows that failed `schema` in the current data (§5.1), in every `invalidRows` mode:
   * `{ index, raw, issues }` with `index` into `options.data`. Empty without a schema.
   */
  getInvalidRows(): readonly InvalidRow[]
  /** Oldest first, at most 100 entries. */
  getDiagnostics(): Diagnostic[]
  /** Releases listeners. Later mutating calls are no-ops that report `DK_TABLE_DESTROYED`. */
  destroy(): void
}
