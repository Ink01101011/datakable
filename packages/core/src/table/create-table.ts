import { DatakableError, defaultPhase } from '../diagnostics/build'
import { DEV } from '../diagnostics/env'
import { createDiagnostics } from '../diagnostics/hub'
import type { RedactionOptions } from '../diagnostics/redact'
import type { Trigger } from '../diagnostics/types'
import { initialSlices, installApis } from '../feature/install'
import { orderFeatures } from '../feature/order'
import type { AnyFeature, ApiOf, SliceUpdater, TableStateFor } from '../feature/types'
import { errorBoundary } from '../intercept/boundary'
import { callUser, errorName } from '../intercept/classify'
import { type ContextBase, createContext } from '../intercept/context'
import type { Interceptor } from '../intercept/define'
import { FALLBACK } from '../intercept/fallbacks'
import type { OpInput, OpName, OpResult } from '../intercept/operations'
import { type Core, createInterceptorRuntime } from '../intercept/runtime'
import { createPipeline } from '../pipeline/runner'
import type { RowModel } from '../pipeline/types'
import { ASYNC_STATUS, type AsyncStatus, asyncControl } from '../source/async-control'
import { tableDiagnostics } from './codes'
import { setTableInternals } from './internals'
import {
  type ControlledState,
  type Listener,
  type Table,
  type TableOptions,
  type TableState,
  UPDATE_DEPTH_LIMIT,
  type Updater,
} from './types'

// Referencing the definitions keeps them in the bundle (`sideEffects: false`).
void tableDiagnostics

const EMPTY: readonly never[] = []

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  v != null && typeof (v as { then?: unknown }).then === 'function'

const freeze = <S extends object>(s: S): S => (DEV ? Object.freeze(s) : s)

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
>(
  options: TableOptions<T, TableStateFor<S, Fs, T>> & { features?: Fs },
): Table<T, TableStateFor<S, Fs, T>> & ApiOf<Fs, T>
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

  const table: Table<T, S> = {
    getState: () => snapshot,
    setState,
    subscribe,
    setOptions,
    getOptions: () => options,
    getData: () => data,
    // Core method: on the literal before installApis, so no feature can take the name.
    getRowModel,
    getDiagnostics: () => hub.getDiagnostics(),
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
    getContext: () => ({ trigger, run }),
    getDataRef: () => data,
    redaction,
  })
  // Features (§3.3) are read once, at creation. `features` is the listed order (API install, conflict
  // reports); `pipeline` is stage order for the runner. Duplicates throw here (config error).
  const features: readonly AnyFeature[] = options.features ?? EMPTY
  const pipeline = orderFeatures(features, hub.table)
  // One asyncControl per table (it holds this table's in-flight requests), first in the list so
  // user / feature interceptors and the core see its signal; the boundary stays outermost.
  // Feature interceptors (pipeline order) come next, then the user's. `timeout` is read once.
  const control = asyncControl(options.timeout === undefined ? {} : { timeout: options.timeout })
  const featureInterceptors = pipeline.flatMap((f) => f.interceptors ?? EMPTY)
  const withControl = (list: readonly Interceptor<OpName>[] | undefined) => [
    control as Interceptor<OpName>,
    ...featureInterceptors,
    ...(list ?? EMPTY),
  ]
  const runtime = createInterceptorRuntime({
    interceptors: withControl(options.interceptors),
    emit: hub.emit,
  })
  runtime.installBoundary(errorBoundary)
  hub.attach(runtime)

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
    const partial: Partial<S> =
      typeof updater === 'function' ? callUser(slot, updater, snapshot) : updater
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
    if (notifying || !pending) return
    notifying = true
    let rethrow: unknown
    try {
      while (pending && !destroyed) {
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

  function setData(next: readonly T[]) {
    if (next === data) return
    data = next
    pending = true
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
    getColumns: () => options.columns,
    getRowKey: () => options.rowKey,
  })

  /** Recomputes the row model if data, state or columns changed (never after destroy). */
  function ensureRowModel() {
    if (!rowModelDirty || destroyed) return
    rowModelDirty = false
    runner.run()
  }

  function getRowModel(): RowModel<T> {
    ensureRowModel()
    // Only empty when destroyed before the first run.
    return runner.current() ?? { rows: EMPTY, filteredCount: 0, totalCount: 0, status: 'idle' }
  }

  /** `data:ingest` with the previous data as fallback; an async result is applied if still latest. */
  function ingest() {
    const seq = ++ingestSeq
    withTrigger('data-change', () => {
      const out = op(
        'data:ingest',
        { data: options.data ?? EMPTY },
        'options.data',
        (ctx) => ctx.input.data as readonly unknown[],
        data,
      )
      if (!isThenable(out)) {
        setData(out as readonly T[])
        return
      }
      Promise.resolve(out).then(
        (d) => {
          if (seq !== ingestSeq || destroyed) return
          withTrigger('data-change', () => {
            setData(d as readonly T[])
            flush()
          })
        },
        // The boundary already reported it; only a strict DatakableError gets here. No unhandled
        // rejection either way (§8.6).
        () => {},
      )
    })
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
  function callApi(method: string, fn: () => unknown): unknown {
    if (destroyed) return destroyedCall(method)
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
      // `features` is read once, at creation: a new value is ignored.
      const next = { ...options, ...partial }
      if ('features' in next && next.features !== previous.features) {
        if (previous.features === undefined) delete next.features
        else next.features = previous.features
      }
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
        if (next.data !== previous.data) ingest()
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
      }
    })
  }

  async function request(
    source: 'fetcher' | 'searchFn',
    core: (signal: AbortSignal) => Promise<unknown>,
    opts: { previous?: unknown; params?: unknown; signal?: AbortSignal } = {},
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
    const value = await runtime.run('async:request', ctx, (c) => core(c.signal as AbortSignal))
    return { value, status: (ctx.meta.get(ASYNC_STATUS) as AsyncStatus | undefined) ?? 'error' }
  }
  setTableInternals(table, { request, features: pipeline })

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
  })
  pending = false
  return table
}
