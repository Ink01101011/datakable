import type { ColumnDef, LooseRow, Path } from '../column'
import type { RedactFn, RedactLevel } from '../diagnostics/redact'
import type { Diagnostic } from '../diagnostics/types'
import type { Interceptor } from '../intercept/define'
import type { OpName } from '../intercept/operations'

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
  /** Row identity (§5.2). Read by redaction here; key handling is the ingest's. */
  rowKey?: Path<LooseRow<T>> | ((row: T) => string | number)
  /** Starting values of owned slices. */
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
  /** Rethrow error-level diagnostics as `DatakableError`. */
  strict?: boolean
  diagnostics?: TableDiagnosticsOptions
}

export interface Table<T, S extends TableState = TableState> {
  /** The current immutable snapshot; the same reference until a slice changes. */
  getState(): S
  setState(updater: Updater<S>): void
  /** Returns the unsubscribe function. One throwing listener never stops the others. */
  subscribe(listener: Listener<S>): () => void
  /** Merges `options` into the current ones (`table:setOptions`). */
  setOptions(options: Partial<TableOptions<T, S>>): void
  getOptions(): Readonly<TableOptions<T, S>>
  /** The ingested data (the previous data while an async ingest is pending or failed). */
  getData(): readonly T[]
  /** Oldest first, at most 100 entries. */
  getDiagnostics(): Diagnostic[]
  /** Releases listeners. Later mutating calls are no-ops that report `DK_TABLE_DESTROYED`. */
  destroy(): void
}
