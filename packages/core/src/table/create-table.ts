import { validateOptionChange, validateOptions } from '../catalog/validator'
import { DatakableError, defaultPhase } from '../diagnostics/build'
import { keepDiagnostics } from '../diagnostics/catalog'
import { DEV } from '../diagnostics/env'
import { type ExplainHost, explainRow, explainTable } from '../diagnostics/explain'
import { createDiagnostics } from '../diagnostics/hub'
import type { RedactionOptions } from '../diagnostics/redact'
import { tracer } from '../diagnostics/tracer'
import type { Trigger } from '../diagnostics/types'
import { initialSlices, installApis } from '../feature/install'
import { orderFeatures } from '../feature/order'
import type { AnyFeature, ApiOf, SliceUpdater, TableStateFor } from '../feature/types'
import { createDataChecks } from '../ingest/data-checks'
import { createDerivedColumns } from '../ingest/derive-columns'
import { createSchemaIngest, type SchemaOutcome } from '../ingest/schema'
import type { InvalidRowsMode } from '../ingest/schema-codes'
import type { StandardSchemaV1 } from '../ingest/standard-schema'
import { errorBoundary } from '../intercept/boundary'
import { callUser, errorName } from '../intercept/classify'
import { type ContextBase, createContext } from '../intercept/context'
import type { Interceptor } from '../intercept/define'
import { FAILED, FALLBACK } from '../intercept/fallbacks'
import type { OpInput, OpName, OpResult } from '../intercept/operations'
import { type Core, createInterceptorRuntime } from '../intercept/runtime'
import { createPipeline } from '../pipeline/runner'
import type { RowModel, RowModelStatus } from '../pipeline/types'
import { ASYNC_STATUS, type AsyncStatus, asyncControl } from '../source/async-control'
import {
  callFetcher,
  checkModes,
  checkResponse,
  type Fetcher,
  FetchFailure,
  type FetchKey,
  type FetchOutcome,
  fetchParams,
  isServer,
  sameParams,
} from '../source/fetcher'
import { checkVersions } from '../versioning/registry'
import { tableDiagnostics } from './codes'
import { createDataMutationCheck, dataMutationDiagnostics } from './data-mutation'
import { deferral, setTableInternals } from './internals'
import { keepReadOnce } from './read-once'
import {
  type ControlledState,
  type Listener,
  type Table,
  type TableOptions,
  type TableState,
  UPDATE_DEPTH_LIMIT,
  type Updater,
} from './types'

keepDiagnostics(tableDiagnostics, dataMutationDiagnostics)

const EMPTY: readonly never[] = []

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  v != null && typeof (v as { then?: unknown }).then === 'function'

const freeze = <S extends object>(s: S): S => (DEV ? Object.freeze(s) : s)

/** The row type: the schema output with a `schema` (§5.1), else `T`. */
export type SchemaRow<T, Sch> = [Sch] extends [StandardSchemaV1]
  ? StandardSchemaV1.InferOutput<Sch>
  : T

/**
 * `createTable` options: with a `schema`, the row type is its output and `data` is the raw input
 * (`unknown[]`, e.g. parsed JSON), validated per row.
 */
export type CreateTableOptions<T, S extends TableState, Sch, M extends InvalidRowsMode> = Omit<
  TableOptions<SchemaRow<T, Sch>, S>,
  'data' | 'schema' | 'invalidRows' | 'fetcher' | 'initialData'
> & {
  data?: readonly ([Sch] extends [StandardSchemaV1] ? unknown : T)[]
  /** With a schema, the raw rows (validated like `data`). */
  initialData?: readonly ([Sch] extends [StandardSchemaV1] ? unknown : T)[]
  /** With a schema, the fetcher returns raw rows (validated like `data`). */
  fetcher?: Fetcher<[Sch] extends [StandardSchemaV1] ? unknown : T>
  // Without an inferred schema (explicit type arguments, a `TableOptions<T>` object) these keep
  // their `TableOptions` types.
  schema?: [Sch] extends [StandardSchemaV1] ? Sch : StandardSchemaV1<unknown, T>
  invalidRows?: [Sch] extends [StandardSchemaV1] ? M : InvalidRowsMode
}

/** Column id: `key` for key columns, `id` for accessor columns. */
const columnId = (c: { key?: unknown; id?: unknown }): unknown => c.key ?? c.id

/**
 * Creates the table store (§3.2): immutable state snapshots, controlled slices, isolated listeners,
 * a re-entrancy guard and `destroy()`. Every unit of work runs as an operation (§3.4) through the
 * table's interceptor runtime, with the errorBoundary outermost and diagnostics on a per-table hub.
 *
 * `ctx.where` is always a constant option path or method name (`options`, `options.data`,
 * `setState`, `destroy`): it reaches fingerprints, docs URLs and issue links unredacted, so it must
 * never carry row keys or cell values.
 */
export function createTable<
  T,
  S extends TableState = never,
  const Fs extends readonly AnyFeature[] = [],
  const Sch extends StandardSchemaV1 | undefined = undefined,
  const M extends InvalidRowsMode = 'drop',
>(
  options: CreateTableOptions<T, TableStateFor<S, Fs, SchemaRow<T, Sch>>, Sch, M> & {
    features?: Fs
  },
): Table<
  SchemaRow<T, Sch>,
  TableStateFor<S, Fs, SchemaRow<T, Sch>>,
  M,
  [Sch] extends [StandardSchemaV1] ? unknown : T
> &
  ApiOf<Fs, SchemaRow<T, Sch>>
export function createTable<T, S extends TableState>(
  initialOptions: TableOptions<T, S>,
): Table<T, S> {
  let options: TableOptions<T, S> = { ...initialOptions }
  let destroyed = false
  let trigger: Trigger = 'init'
  /** Pipeline run id; each `pipeline:run` increments it. */
  let run = 0
  let data: readonly T[] = EMPTY
  let ingestSeq = 0
  /** Data given by the user has been applied once (`RowModel.isInitialLoad`, §6.6). */
  let loaded = false
  /** The last `data:ingest` failed (op fallback): `status: 'error'` until one succeeds (§6.6). */
  let ingestFailed = false
  /** The ingest whose async schema validation is in flight (`status: 'validating'`); 0: none. */
  let validatingSeq = 0
  /** In-flight `async:request`s per source: `status` 'fetching' / 'searching' (§6.6). */
  const inflight = { fetcher: 0, searchFn: 0 }
  /** The latest fetcher request failed or returned a bad response: 'error' until one applies. */
  let fetchFailed = false
  /** `rowCount` of the last applied fetcher result (§6.5). */
  let fetchedRowCount: number | undefined
  /** Params of the last fetcher request; a flush with other params starts a new one (§7.1). */
  let fetchedParams: FetchKey | undefined
  /** Rows of the current data that failed the schema (`getInvalidRows`, §5.1). */
  let schemaOutcome: SchemaOutcome | undefined
  /**
   * SSR (§7.2): `options.initialData` until the creation ingest read it (`undefined` with `data`),
   * then its ingested rows while they are the table's data (`initialRows`).
   */
  let initialInput = options.data === undefined ? options.initialData : undefined
  let initialRows: readonly unknown[] | undefined
  /** `createDeferred` (§7.2): the async work waiting for `startTable`; `undefined` once started. */
  let waiting: Set<'fetcher' | 'searchFn'> | undefined = deferral.depth > 0 ? new Set() : undefined
  /** Every source deferred since creation (`DK_SSR_ASYNC_DEFERRED`). */
  const deferredSources: ('fetcher' | 'searchFn')[] = []

  let controlled = new Set<string>()
  let snapshot: S
  /** The snapshot listeners last saw (`prev` of the next notification). */
  let notified: S
  /** A committed change (state or data) not yet notified. */
  let pending = false
  let notifying = false
  let rounds = 0
  let loopReported = false
  let current: number | undefined
  let listenerSeq = 0
  const listeners = new Map<number, Listener<S>>()
  /** Depth of feature API calls in progress: listeners are notified when the outermost returns. */
  let apiDepth = 0
  /** Data, state or columns changed since the row model was computed. */
  let rowModelDirty = true
  /** Diagnostic context (§8.1): the data mode of each pipeline feature (set once features load). */
  const modes: Record<string, 'client' | 'server'> = {}

  const table: Table<T, S> = {
    getState: () => snapshot,
    setState,
    subscribe,
    setOptions,
    getOptions: () => options,
    getData: () => data,
    // Core method: on the literal before installApis, so no feature can take the name.
    getRowModel,
    getInvalidRows: () => schemaOutcome?.invalid ?? EMPTY,
    getDiagnostics: () => hub.getDiagnostics(),
    // Core methods (§8.4), read-only: also on the literal before installApis.
    explain: () => explainTable(explainHost),
    explainRow: (key) => explainRow(explainHost, key),
    refetch,
    destroy,
  }

  // Redaction (§8.2): `diagnostics.redact` gives the level or a custom rule; column defs give the
  // sensitive columns and whether the rowKey column is sensitive. Both are read per emit, so
  // `setOptions({ columns })` is followed.
  const redactOption = options.diagnostics?.redact
  const redaction: RedactionOptions = {
    ...(typeof redactOption === 'string' ? { level: redactOption } : {}),
    ...(typeof redactOption === 'function' ? { redact: redactOption } : {}),
    sensitiveColumns,
    rowKeySensitive: () =>
      typeof options.rowKey === 'string' && sensitiveColumns().includes(options.rowKey),
  }
  const hub = createDiagnostics({
    ...(options.name === undefined ? {} : { name: options.name }),
    table,
    onDiagnostic: (d) => options.onDiagnostic?.(d),
    ...(options.strict === undefined ? {} : { strict: options.strict }),
    getContext: () => ({ trigger, run, mode: modes }),
    getDataRef: () => data,
    redaction,
  })
  // Option validator (§3.4, `table:init`), development only: before anything reads the options.
  // Invalid values throw DK_INVALID_OPTION; unknown / no-effect options are reported on the hub.
  if (DEV) validateOptions(options, { table: hub.table, emit: hub.emit })
  // Features (§3.3) are read once, at creation. `features` is the listed order (API install, conflict
  // reports); `pipeline` is stage order for the runner. Duplicates throw here (config error).
  const features: readonly AnyFeature[] = options.features ?? EMPTY
  const pipeline = orderFeatures(features, hub.table)
  // Data modes (§7.1): DK_MODE_ORDER, DK_FETCHER_WITHOUT_SERVER_MODE (config errors).
  checkModes(pipeline, options.fetcher, hub.table)
  const serverFeatures = pipeline.filter(isServer)
  for (const f of pipeline) if (f.stage !== 'none') modes[f.name] = f.mode ?? 'client'
  // One asyncControl per table (it holds this table's in-flight requests), first in the list so
  // user / feature interceptors and the core see its signal; the boundary stays outermost.
  // Feature interceptors (pipeline order) come next, then the user's. `timeout` is read once.
  const control = asyncControl(options.timeout === undefined ? {} : { timeout: options.timeout })
  const featureInterceptors = pipeline.flatMap((f) => f.interceptors ?? EMPTY)
  // The tracer (§3.4, explain timings) is development-only: `DEV` folds to `false` in production
  // builds, which drops it from the bundle; there it is opt-in with `interceptors: [tracer()]`.
  const traced = DEV ? [tracer() as Interceptor<OpName>] : EMPTY
  const withControl = (list: readonly Interceptor<OpName>[] | undefined) => [
    control as Interceptor<OpName>,
    ...traced,
    ...featureInterceptors,
    ...(list ?? EMPTY),
  ]
  const runtime = createInterceptorRuntime({
    interceptors: withControl(options.interceptors),
    emit: hub.emit,
  })
  runtime.installBoundary(errorBoundary)
  hub.attach(runtime)
  // Dev check (§5.3): the same `data` array passed again with changed contents (DK_DATA_MUTATED).
  const dataCheck = DEV ? createDataMutationCheck(hub.emit) : undefined
  // Feature `requires.core` (throws DK_FEATURE_INCOMPATIBLE), duplicate cores, version mismatch.
  checkVersions(features, hub.emit, hub.table)
  // Ingest data checks (§5.3) and zero-config columns (§4.1): both read only the first rows.
  const dataChecks = createDataChecks(hub.emit)
  const derivedColumns = createDerivedColumns()
  // Schema ingest (§5.1): `schema` and `invalidRows` are read once (validated above).
  const schemaIngest = options.schema
    ? createSchemaIngest(options.schema, options.invalidRows ?? 'drop', () => options.columns)
    : undefined

  function sensitiveColumns(): string[] {
    const out: string[] = []
    for (const c of options.columns ?? EMPTY) {
      const id = columnId(c as { key?: unknown; id?: unknown })
      if (c.sensitive && typeof id === 'string') out.push(id)
    }
    return out
  }

  function base(): ContextBase {
    return { table, run, trigger, phase: defaultPhase(), emit: hub.emit }
  }

  function op<O extends OpName>(
    name: O,
    input: OpInput<O>,
    where: string,
    core: Core<O>,
    fallback?: unknown,
  ): OpResult<O> {
    const ctx = createContext(name, input, where, base())
    if (fallback !== undefined) ctx.meta.set(FALLBACK, fallback)
    return runtime.run(name, ctx, core)
  }

  function withTrigger<R>(t: Trigger, fn: () => R): R {
    const prev = trigger
    trigger = t
    try {
      return fn()
    } finally {
      trigger = prev
    }
  }

  // --- state -------------------------------------------------------------------------------------

  function controlledKeys(state: ControlledState<S> | undefined): Set<string> {
    const keys = new Set<string>()
    if (state) for (const k of Object.keys(state)) if (state[k] !== undefined) keys.add(k)
    return keys
  }

  /** `s` with the controlled slices from `options.state`; `s` itself when none differ. */
  function overlay(s: S): S {
    let next: TableState | undefined
    const state = options.state as TableState | undefined
    if (state) {
      for (const k of controlled) {
        if (!Object.is(s[k], state[k])) {
          next ??= { ...s }
          next[k] = state[k]
        }
      }
    }
    return next ? freeze(next as S) : s
  }

  function commit(next: S) {
    snapshot = next
    pending = true
    rowModelDirty = true
  }

  function warnControlled(dropped: string[] | undefined) {
    if (options.onStateChange || controlled.size === 0) return
    const slices = dropped ?? [...controlled]
    hub.emit('DK_CONTROLLED_WITHOUT_HANDLER', { slices, dropped: dropped !== undefined })
  }

  function syncControlled() {
    controlled = controlledKeys(options.state)
    const next = overlay(snapshot)
    if (next !== snapshot) commit(next)
    warnControlled(undefined)
  }

  function dispatch(updater: Updater<S>, slot: string) {
    // A method argument, not an option: `where` = `operation table.setState at updater`.
    const partial: Partial<S> =
      typeof updater === 'function'
        ? callUser(
            'updater',
            updater,
            snapshot,
            undefined,
            slot === 'setState' ? 'table.setState' : `${slot}.setState`,
          )
        : updater
    if (partial === null || typeof partial !== 'object') return
    let next: TableState | undefined
    let changes: TableState | undefined
    let dropped: string[] | undefined
    for (const k of Object.keys(partial)) {
      const v = (partial as TableState)[k]
      if (Object.is(snapshot[k], v)) continue
      if (controlled.has(k)) {
        if (options.onStateChange) {
          changes ??= {}
          changes[k] = v
        } else {
          dropped ??= []
          dropped.push(k)
        }
        continue
      }
      next ??= { ...snapshot }
      next[k] = v
    }
    // The owner is told first: if onStateChange throws, nothing is committed (state unchanged).
    if (changes && options.onStateChange) {
      const c = changes as Partial<S>
      callUser('onStateChange', options.onStateChange, (prev: Partial<S>) => ({ ...prev, ...c }))
    }
    if (next) commit(freeze(next as S))
    if (dropped) warnControlled(dropped)
  }

  /**
   * Notifies listeners until no change is pending. Updates made by listeners are committed at once
   * and notified in the next round (not nested), so every listener sees rounds in order.
   */
  function flush() {
    if (notifying) return
    void syncFetch()
    if (!pending) return
    notifying = true
    let rethrow: unknown
    try {
      while (pending && !destroyed) {
        // Server state changed (this round's state): the fetch starts in the same notification.
        void syncFetch()
        pending = false
        rounds++
        const prev = notified
        const state = snapshot
        notified = state
        // Listeners read the row model of the state they are notified with.
        ensureRowModel()
        for (const [id, listener] of [...listeners]) {
          // A listener may destroy the table: the rest of the round is not notified.
          if (destroyed) break
          current = id
          try {
            listener(state, prev)
          } catch (e) {
            // strict: a DatakableError (e.g. DK_UPDATE_LOOP) thrown inside the listener.
            if (e instanceof DatakableError) {
              rethrow ??= e
              continue
            }
            try {
              const name = errorName(e)
              hub.emit(
                'DK_LISTENER_FAILED',
                { listener: id, ...(name === undefined ? {} : { errorName: name }) },
                { cause: e },
              )
            } catch (strictError) {
              rethrow ??= strictError
            }
          }
        }
      }
    } finally {
      notifying = false
      rounds = 0
      loopReported = false
      current = undefined
    }
    if (rethrow !== undefined) throw rethrow
  }

  /** `false` (and one `DK_UPDATE_LOOP`) when a re-entrant update would exceed the depth limit. */
  function admit(slices: string[]): boolean {
    if (!notifying || rounds < UPDATE_DEPTH_LIMIT) return true
    if (!loopReported) {
      loopReported = true
      hub.emit('DK_UPDATE_LOOP', {
        limit: UPDATE_DEPTH_LIMIT,
        slices,
        ...(current === undefined ? {} : { listener: current }),
      })
    }
    return false
  }

  function destroyedCall(method: string) {
    withTrigger(`api:${method}`, () => hub.emit('DK_TABLE_DESTROYED', { method }))
  }

  // --- data --------------------------------------------------------------------------------------

  /** Applies ingested data; `given`: it came from a user `options.data` (marks the first load). */
  function setData(next: readonly T[], given: boolean) {
    if (given && !loaded) {
      // isInitialLoad flips: a new row model and a notification even for the same reference.
      loaded = true
      pending = true
      rowModelDirty = true
    }
    if (next === data) return
    data = next
    pending = true
    // After `data` is set: diagnostics dedupe per data reference.
    dataChecks.check(data, options.columns)
    // The pipeline runs before the next notification (or on getRowModel), as `pipeline:run` with
    // ctx.meta[FALLBACK] = the last good row model (pipeline/runner.ts).
    rowModelDirty = true
  }

  // --- row model ---------------------------------------------------------------------------------

  const runner = createPipeline<T>({
    runtime,
    emit: hub.emit,
    features: pipeline,
    listed: features,
    base,
    nextRun: () => ++run,
    getData: () => data,
    getState: () => snapshot,
    getColumns: () => options.columns ?? derivedColumns(data),
    getRowKey: () => options.rowKey,
    isInitialLoad: () => !loaded,
    status,
    issues: (index) => schemaOutcome?.flagged?.get(index),
    flagMode: schemaIngest !== undefined && options.invalidRows === 'flag',
    // Time-sliced work ended (§9.1): 'pending' → the finished row model, never silent (§6.6).
    refresh: (t) => {
      if (destroyed) return
      withTrigger(t, () => {
        touch()
        if (apiDepth === 0) flush()
      })
    },
  })

  const explainHost: ExplainHost = {
    table,
    features: pipeline,
    rowModel: getRowModel as () => RowModel<unknown>,
    lastRun: runner.lastRun,
    replay: runner.replayContext,
    data: () => data,
    state: () => snapshot,
    rowKey: () => options.rowKey,
    schemaMode: () => (schemaIngest ? (options.invalidRows ?? 'drop') : undefined),
    schema: () => schemaOutcome,
    diagnostics: () => hub.getDiagnostics(),
    redaction,
  }

  /**
   * Status from outside the pipeline (§6.6): a failed ingest or fetch, an in-flight fetcher /
   * `searchFn`, a running async schema, the search slice (`pending` / `searching` / `error`).
   * Precedence: error > fetching > searching >
   * validating > pending > idle.
   */
  function status(): RowModelStatus {
    const search = searchStatus()
    if (ingestFailed || fetchFailed || search === 'error') return 'error'
    if (inflight.fetcher > 0) return 'fetching'
    if (inflight.searchFn > 0 || search === 'searching') return 'searching'
    if (validatingSeq !== 0) return 'validating'
    // Deferred async work (SSR, §7.2) waits for the client: 'pending'.
    return search === 'pending' || (waiting !== undefined && waiting.size > 0) ? 'pending' : 'idle'
  }

  /** The `status` of the first search-stage slice that reports one (§6.3). */
  function searchStatus(): unknown {
    for (const f of pipeline) {
      if (f.stage !== 'search') continue
      const s = (snapshot as Record<string, unknown> | undefined)?.[f.name]
      if (s !== null && typeof s === 'object' && 'status' in s) {
        const v = (s as { status: unknown }).status
        if (v !== 'idle') return v
      }
    }
    return 'idle'
  }

  /** A row model change not caused by state: recompute and notify on the next flush. */
  function touch() {
    pending = true
    rowModelDirty = true
  }

  /** Recomputes the row model if data, state or columns changed (never after destroy). */
  function ensureRowModel() {
    if (!rowModelDirty || destroyed) return
    rowModelDirty = false
    runner.run()
  }

  function getRowModel(): RowModel<T> {
    ensureRowModel()
    // Only empty when destroyed before the first run.
    return (
      runner.current() ?? {
        rows: EMPTY,
        filteredCount: 0,
        totalCount: 0,
        status: status(),
        isInitialLoad: !loaded,
      }
    )
  }

  /**
   * Applies the result of the latest `data:ingest`. A fallback (the boundary set `FAILED`) keeps
   * the previous data, sets `status: 'error'` and never marks the table loaded (§6.6, §8.6).
   */
  function applyIngest(out: readonly unknown[], failed: boolean, given: boolean, initial = false) {
    if (validatingSeq !== 0) {
      validatingSeq = 0
      touch()
    }
    if (failed) {
      ingestFailed = true
      touch()
      return
    }
    if (ingestFailed) {
      ingestFailed = false
      touch()
    }
    schemaOutcome = schemaIngest?.outcome(out)
    setData(out as readonly T[], given)
    // `initialData` is the initial async result only while it is the data (§7.2).
    initialRows = initial ? out : undefined
  }

  /**
   * `data:ingest` with the previous data as fallback: the schema step (§5.1) runs in its core. An
   * async result is applied if still latest. `fetched`: rows of an applied fetcher result (§7.1),
   * ingested like `options.data` (schema, data checks) and marking the table loaded.
   */
  function ingest(fetched?: readonly unknown[]) {
    const seq = ++ingestSeq
    // At creation, `initialData` stands in for a missing `data` (§7.2); read once.
    const initial = fetched === undefined && initialInput !== undefined
    const input = fetched ?? (initial ? initialInput : options.data)
    initialInput = undefined
    const given = input !== undefined
    const source: Trigger = fetched ? 'fetch' : 'data-change'
    // A validation still in flight is superseded (its result is discarded): not 'validating' now,
    // unless this ingest's own schema step goes async.
    if (validatingSeq !== 0) {
      validatingSeq = 0
      touch()
    }
    try {
      withTrigger(source, () => {
        const ctx = createContext(
          'data:ingest',
          { data: input ?? EMPTY },
          fetched ? 'fetcher' : initial ? 'options.initialData' : 'options.data',
          base(),
        )
        ctx.meta.set(FALLBACK, data)
        let sync = true
        const out = runtime.run('data:ingest', ctx, (c) => {
          const input = c.input.data as readonly unknown[]
          if (!schemaIngest) return input
          const r = schemaIngest.validate(input, c.emit)
          if (isThenable(r) && seq === ingestSeq && !destroyed) {
            // 'validating' is never silent: a new row model and a notification now (§6.6).
            validatingSeq = seq
            touch()
            if (!sync) flush()
          }
          return r
        })
        sync = false
        if (!isThenable(out)) {
          applyIngest(out, ctx.meta.has(FAILED), given, initial)
          return
        }
        const settle = (d: readonly unknown[], failed: boolean) => {
          if (seq !== ingestSeq || destroyed) return
          withTrigger(source, () => {
            applyIngest(d, failed, given, initial)
            flush()
          })
        }
        Promise.resolve(out).then(
          (d) => settle(d, ctx.meta.has(FAILED)),
          // A DatakableError the boundary rethrew (strict, or `invalidRows: 'throw'` with an async
          // schema, already reported): the previous data is kept with 'error'. No unhandled
          // rejection either way (§8.6).
          () => settle(data, true),
        )
      })
    } finally {
      // Dev (§5.3): fingerprint `data` after the core read it, so the check never takes reads
      // first; also when the ingest threw, so a later same-reference check compares this data.
      if (!fetched) dataCheck?.remember(options.data)
    }
  }

  // --- API ---------------------------------------------------------------------------------------

  /** `state:dispatch` (where = `slot`, a constant method / feature name); notifies unless batched. */
  function update(updater: Updater<S>, slot: string) {
    void op('state:dispatch', { updater }, slot, (): undefined => {
      dispatch(updater, slot)
    })
    if (apiDepth === 0) flush()
  }

  function setState(updater: Updater<S>) {
    if (destroyed) return destroyedCall('setState')
    if (!admit(typeof updater === 'function' ? [] : Object.keys(updater ?? {}))) return
    withTrigger('api:setState', () => update(updater, 'setState'))
  }

  // --- features ----------------------------------------------------------------------------------

  /** A feature's `ctx.setState`: replaces its own slice (trigger: the API call's, if any). */
  function setSlice(name: string, updater: SliceUpdater<unknown>) {
    if (destroyed) return destroyedCall(`${name}.setState`)
    if (!admit([name])) return
    const slice: Updater<S> =
      typeof updater === 'function'
        ? (prev) => ({ [name]: (updater as (p: unknown) => unknown)(prev[name]) }) as Partial<S>
        : ({ [name]: updater } as Partial<S>)
    update(slice, name)
  }

  /** Runs a feature API method (wrapped once by `installApis`). */
  function callApi(method: string, fn: () => unknown, ifDestroyed?: () => unknown): unknown {
    if (destroyed) {
      destroyedCall(method)
      return ifDestroyed?.()
    }
    return withTrigger(`api:${method}`, () => {
      apiDepth++
      try {
        return fn()
      } finally {
        apiDepth--
        if (apiDepth === 0) flush()
      }
    })
  }

  function subscribe(listener: Listener<S>): () => void {
    if (destroyed) {
      destroyedCall('subscribe')
      return () => {}
    }
    const id = ++listenerSeq
    listeners.set(id, listener)
    return () => {
      listeners.delete(id)
    }
  }

  function setOptions(partial: Partial<TableOptions<T, S>>) {
    if (destroyed) return destroyedCall('setOptions')
    if (!admit(Object.keys(partial.state ?? {}))) return
    withTrigger('setOptions', () => {
      const previous = options
      const next = { ...options, ...partial }
      // Option validator (§3.4, `table:setOptions`, development): an invalid value throws before
      // anything changes. Read-once options (`features`, `timeout`, `diagnostics`, …) keep their
      // value in every build.
      if (DEV) validateOptionChange(partial, next, previous, { table: hub.table, emit: hub.emit })
      else keepReadOnce(partial, next, previous)
      if ('fetcher' in partial) checkModes(pipeline, next.fetcher, hub.table, 'setOptions')
      void op('table:setOptions', { options: next, previous }, 'options', (): undefined => {
        options = next
        if (next.interceptors !== previous.interceptors) {
          runtime.setInterceptors(withControl(next.interceptors))
        }
        if ('state' in partial || 'onStateChange' in partial) syncControlled()
        if (next.columns !== previous.columns || next.rowKey !== previous.rowKey) {
          rowModelDirty = true
          pending = true
        }
        // The page count changed (§6.5): listeners re-read it (and pagination clamps).
        if (next.rowCount !== previous.rowCount) pending = true
        // A new fetcher reference runs at once, even with the same params (flush → syncFetch).
        if (next.fetcher !== previous.fetcher) fetchedParams = undefined
        // New data is checked when applied (setData); same data with new columns is checked here.
        if (next.data !== previous.data) ingest()
        else {
          if ('data' in partial) dataCheck?.check(next.data)
          if (next.columns !== previous.columns) dataChecks.check(data, next.columns)
        }
      })
      flush()
    })
  }

  function destroy() {
    if (destroyed) return
    withTrigger('api:destroy', () => {
      try {
        void op('table:destroy', undefined, 'destroy', (): undefined => {
          destroyed = true
        })
      } finally {
        // Even if an interceptor skipped the core: the table is destroyed.
        destroyed = true
        ingestSeq++
        listeners.clear()
        runner.dispose()
      }
    })
  }

  /** Moves the in-flight count of `source`; a status change is never silent (§6.6). */
  function track(source: 'fetcher' | 'searchFn', delta: 1 | -1) {
    const before = status()
    inflight[source] += delta
    if (status() !== before) touch()
  }

  async function request(
    source: 'fetcher' | 'searchFn',
    core: (signal: AbortSignal) => Promise<unknown>,
    opts: {
      previous?: unknown
      params?: unknown
      signal?: AbortSignal
      onSettle?: (value: unknown, status: AsyncStatus) => void
    } = {},
  ): Promise<{ value: unknown; status: AsyncStatus }> {
    if (destroyed) return { value: opts.previous, status: 'aborted' }
    const ctx = createContext(
      'async:request',
      opts.params === undefined ? { source } : { source, params: opts.params },
      source,
      { ...base(), trigger: 'fetch' },
      opts.signal,
    )
    ctx.meta.set(FALLBACK, opts.previous)
    // 'fetching' / 'searching' starts now: a new row model and a notification (unless batched).
    track(source, 1)
    if (apiDepth === 0) flush()
    let value: unknown = opts.previous
    let outcome: AsyncStatus = 'error'
    try {
      value = await runtime.run('async:request', ctx, (c) => core(c.signal as AbortSignal))
      outcome = (ctx.meta.get(ASYNC_STATUS) as AsyncStatus | undefined) ?? 'error'
      return { value, status: outcome }
    } finally {
      // Also when it rejected (strict): the status never stays in flight.
      settle(source, () => opts.onSettle?.(value, outcome))
    }
  }

  /** Ends a request in one batch: its result applied and the status cleared, one notification. */
  function settle(source: 'fetcher' | 'searchFn', apply: () => void) {
    if (destroyed) {
      inflight[source]--
      return
    }
    withTrigger('fetch', () => {
      const before = status()
      apiDepth++
      try {
        inflight[source]--
        apply()
      } finally {
        if (status() !== before) touch()
        apiDepth--
        if (apiDepth === 0) flush()
      }
    })
  }

  // --- server source (§7.1) ----------------------------------------------------------------------

  /**
   * Starts a fetcher request when the server-mode state differs from the last request's (or
   * `force`: `refetch()`). Resolves with the outcome; never rejects.
   */
  function syncFetch(force = false): Promise<FetchOutcome> | undefined {
    const fetcher = options.fetcher
    if (typeof fetcher !== 'function' || destroyed) return
    const params = fetchParams(serverFeatures, snapshot)
    if (!force && fetchedParams && sameParams(fetchedParams, params)) return
    // Deferred (SSR, §7.2): no request until startTable; then the latest params are fetched.
    if (defer('fetcher')) return
    fetchedParams = params
    let result: FetchOutcome['status'] | undefined
    const done = (): FetchOutcome => ({ status: result ?? (destroyed ? 'superseded' : 'error') })
    return request('fetcher', (signal) => callFetcher(fetcher, params, signal), {
      params,
      onSettle: (value, outcome) => {
        result = outcome === 'superseded' || outcome === 'aborted' ? 'superseded' : 'error'
        if (applyFetch(value, outcome)) result = 'applied'
      },
      // strict: the DatakableError was reported by the hub; the status is 'error' (applyFetch).
    }).then(done, done)
  }

  function refetch(): Promise<FetchOutcome> {
    if (destroyed) {
      destroyedCall('refetch')
      return Promise.resolve({ status: 'superseded' })
    }
    return (
      withTrigger('api:refetch', () => syncFetch(true)) ?? Promise.resolve({ status: 'applied' })
    )
  }

  function failFetch() {
    if (fetchFailed) return
    fetchFailed = true
    touch()
  }

  /**
   * Applies a fetcher outcome; only the latest request reaches `'applied'` (asyncControl). `true`
   * when its rows were applied.
   */
  function applyFetch(value: unknown, outcome: AsyncStatus): boolean {
    if (outcome === 'superseded') {
      hub.emit('DK_FETCH_ABORTED', {})
      return false
    }
    if (outcome === 'aborted') return false
    // 'error' / 'timeout': already reported by the errorBoundary / asyncControl.
    if (outcome !== 'applied') {
      failFetch()
      return false
    }
    if (value instanceof FetchFailure) {
      failFetch()
      const name = errorName(value.error)
      hub.emit(
        'DK_FETCH_FAILED',
        { ...(name === undefined ? {} : { errorName: name }), hadRows: loaded },
        { cause: value.error },
      )
      return false
    }
    const bad = checkResponse(
      value,
      serverFeatures.some((f) => f.stage === 'paginate'),
    )
    if (bad) {
      failFetch()
      hub.emit('DK_FETCH_BAD_RESPONSE', bad)
      return false
    }
    if (fetchFailed) {
      fetchFailed = false
      touch()
    }
    const result = value as { rows: readonly unknown[]; rowCount?: number }
    fetchedRowCount = result.rowCount ?? result.rows.length
    ingest(result.rows)
    return true
  }

  /** `true` (and `source` recorded as waiting) while deferred (§7.2). */
  function defer(source: 'fetcher' | 'searchFn'): boolean {
    if (waiting === undefined) return false
    if (!waiting.has(source)) {
      waiting.add(source)
      if (!deferredSources.includes(source)) deferredSources.push(source)
      // 'pending' is never silent (§6.6).
      touch()
    }
    return true
  }

  /** `startTable` (§7.2): the deferred work starts; listeners see the new status at once. */
  function start() {
    if (waiting === undefined || destroyed) return
    const had = waiting.size > 0
    waiting = undefined
    if (!had) return
    // The pipeline re-runs: 'pending' ends and the search feature's check starts its searchFn.
    touch()
    withTrigger('hydrate', () => flush())
  }

  setTableInternals(table, {
    request,
    features: pipeline,
    rowCount: () => (typeof options.fetcher === 'function' ? fetchedRowCount : options.rowCount),
    hasFetcher: () => typeof options.fetcher === 'function',
    emit: hub.emit,
    defer,
    deferred: () => deferredSources,
    start,
    initialRows: () =>
      initialRows !== undefined && initialRows === data ? initialRows : undefined,
  })

  // --- init --------------------------------------------------------------------------------------

  controlled = controlledKeys(options.state)
  // Feature `initialState()` slices, with `options.initialState` on top per slice.
  snapshot = overlay(freeze(initialSlices(features, options.initialState, hub.emit) as S))
  notified = snapshot
  // Merges the feature APIs onto the table; a name clash throws DK_FEATURE_API_CONFLICT.
  installApis(features, {
    table: table as unknown as Table<unknown, TableState>,
    tableName: hub.table,
    emit: hub.emit,
    getSlice: (name) => snapshot[name],
    setSlice,
    call: callApi,
  })
  withTrigger('init', () => {
    // `void`: sync ops never return a promise (op kinds, §3.4).
    void op('table:init', { options }, 'options', (): undefined => {
      // Ingest first: dedupe is per data reference, so warnings follow the initial data.
      ingest()
      warnControlled(undefined)
    })
    // initialData answers the initial server state (§7.2): no first request, its total as rowCount.
    if (options.initialData !== undefined && options.data === undefined) {
      fetchedParams = fetchParams(serverFeatures, snapshot)
      fetchedRowCount = options.rowCount ?? options.initialData.length
    }
    // Server source (§7.1): the first request starts now ('fetching', isInitialLoad: true).
    void syncFetch()
  })
  pending = false
  return table
}
