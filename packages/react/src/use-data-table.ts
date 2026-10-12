import {
  type AnyFeature,
  type ApiOf,
  type ColumnDef,
  type CreateTableOptions,
  createTable,
  type Diagnostic,
  emitTableDiagnostic,
  type InvalidRowsMode,
  isOptionsDefinition,
  type RowModel,
  registerPackage,
  type SchemaRow,
  type StandardSchemaV1,
  type Table,
  type TableState,
  type TableStateFor,
} from '@datakable/core'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useSyncExternalStore,
} from 'react'
import { version } from '../package.json'
import { reactDiagnostics } from './codes'

// Referencing the definitions keeps them in the bundle (`sideEffects: false`).
void reactDiagnostics

// No @types/node here: declare just what is read (bundlers fold it, like core's `DEV`).
declare const process: { env: { NODE_ENV?: string } }
const DEV: boolean = process.env.NODE_ENV !== 'production'

/** No layout effects on the server (React 18 warns about them there). */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * `useDataTable` options: `createTable`'s (§3.2), with `cell` / `invalidCell` returning a
 * `ReactNode` (§10). Read once, at creation: `features`, `schema`, `invalidRows`, `initialState`,
 * `name`, `timeout`, `strict`, `diagnostics`. Every other option follows the latest render.
 */
export type UseDataTableOptions<
  T,
  S extends TableState = TableState,
  Sch = undefined,
  M extends InvalidRowsMode = 'drop',
> = Omit<CreateTableOptions<T, S, Sch, M>, 'columns'> & {
  /**
   * Compared by reference (§10): a new array tells the table the columns changed. Define them
   * outside the component or memoise them (`DK_UNSTABLE_COLUMNS` in development).
   */
  columns?: readonly ColumnDef<SchemaRow<T, Sch>, ReactNode>[]
}

/**
 * What `useDataTable` returns: the table (its methods and the installed features' APIs) with the
 * `state` and `rowModel` of this render. A new object whenever the table notifies, so it can be a
 * dependency of `useMemo` / `memo` children; the same object while nothing changed.
 */
export type UseDataTableResult<
  T,
  S extends TableState = TableState,
  M extends InvalidRowsMode = 'drop',
  In = T,
  Api = unknown,
> = Table<T, S, M, In> &
  Api & {
    /** The state snapshot of this render (`getState()`). */
    readonly state: S
    /** The row model of this render (`getRowModel()`, §6.6): rows, counts, status. */
    readonly rowModel: RowModel<T, M>
  }

type Options = Record<string, unknown> & { features?: readonly AnyFeature[] }
type AnyTable = Table<unknown, TableState> & Record<string, unknown>
type Callback = (arg: never) => unknown

/** Options forwarded through `setOptions` when they change; the rest are read once (§3.4). */
const SYNCED = [
  'data',
  'columns',
  'rowKey',
  'state',
  'onStateChange',
  'interceptors',
  'onDiagnostic',
  'fetcher',
  'rowCount',
] as const

/** Given to the table as stable wrappers that call the latest prop (latest-ref). */
const CALLBACKS = ['onStateChange', 'onDiagnostic', 'fetcher'] as const
type CallbackKey = (typeof CALLBACKS)[number]

/** Renders in a row with a new reference before `DK_UNSTABLE_*` is reported. */
const UNSTABLE_AFTER = 2

interface Instance {
  table: AnyTable
  destroyed: boolean
  mounted: boolean
  /** The options of the latest committed render (what the wrappers call). */
  latest: Options
  /** The option values the table has (user values; callbacks count by presence). */
  synced: Options
  readonly wrappers: Record<CallbackKey, Callback>
  /** `onDiagnostic` calls made while rendering, delivered after the commit. */
  queue: Diagnostic[] | undefined
  rendering: number
  /** Inside the hook's own `setOptions` call. */
  syncing: boolean
  /** That call notified: the next commit is the re-render it caused. */
  selfCaused: boolean
  /** Notifications seen; part of the view cache key (a notification is never silent, §6.6). */
  version: number
  view: { table: AnyTable; version: number; value: object } | undefined
  // Dev: DK_UNSTABLE_* bookkeeping.
  /** The options of the previous committed render. */
  seen: Options
  unstable: Map<string, number>
  warned: Set<string>
}

let registered = false

/**
 * Binds a table to a component (§10): the table is created once per component instance and
 * destroyed on unmount; renders read it through `useSyncExternalStore` (with
 * `getServerSnapshot`), and options are synced with `table.setOptions` in a layout effect, never
 * during render.
 *
 * - `features` (and the other read-once options) are read at creation: a new inline `features`
 *   array never recreates the table.
 * - `fetcher`, `onStateChange` and `onDiagnostic` may be inline functions: the table always calls
 *   the latest one, and a new reference never refetches (call `refetch()` when a value the fetcher
 *   reads changes).
 * - `columns`, `data` and a `rowKey` function are compared by reference: memoise them.
 * - Controlled slices (§3.2): pass `state` and `onStateChange`; changes come back through `state`.
 *
 * `@datakable/react` installs no features by default; `datakable`'s `useDataTable` installs the
 * default preset.
 */
export function useDataTable<
  T,
  S extends TableState = never,
  const Fs extends readonly AnyFeature[] = [],
  const Sch extends StandardSchemaV1 | undefined = undefined,
  const M extends InvalidRowsMode = 'drop',
>(
  options: UseDataTableOptions<T, TableStateFor<S, Fs, SchemaRow<T, Sch>>, Sch, M> & {
    features?: Fs
  },
): UseDataTableResult<
  SchemaRow<T, Sch>,
  TableStateFor<S, Fs, SchemaRow<T, Sch>>,
  M,
  [Sch] extends [StandardSchemaV1] ? unknown : T,
  ApiOf<Fs, SchemaRow<T, Sch>>
>
export function useDataTable(options: Options): unknown {
  const ref = useRef<Instance | null>(null)
  // Created during the first render (React keeps the ref across the StrictMode double render). A
  // fetcher's first request starts here, as with createTable (§7.1).
  if (ref.current === null) ref.current = createInstance(options)
  const inst = ref.current
  const table = inst.table
  const [, rerender] = useReducer((n: number) => n + 1, 0)

  const subscribe = useCallback(
    (onChange: () => void) => {
      // Replaced or destroyed meanwhile (`<Activity>`): nothing to subscribe to.
      if (inst.table !== table || inst.destroyed) return () => {}
      return table.subscribe(() => {
        inst.version++
        if (inst.syncing) inst.selfCaused = true
        onChange()
      })
    },
    [inst, table],
  )
  const getSnapshot = useCallback(() => snapshot(inst, table), [inst, table])
  const view = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useIsomorphicLayoutEffect(() => {
    inst.mounted = true
    // Destroyed while hidden (`<Activity>`): a new table, from the latest options.
    if (inst.destroyed) {
      recreate(inst)
      rerender()
    }
    return () => {
      inst.mounted = false
      // Deferred: the StrictMode effect re-run mounts again synchronously and keeps the table.
      queueMicrotask(() => {
        if (inst.mounted || inst.destroyed) return
        inst.destroyed = true
        inst.table.destroy()
      })
    }
  }, [inst])

  useIsomorphicLayoutEffect(() => {
    inst.latest = options
    const selfCaused = inst.selfCaused
    inst.selfCaused = false
    if (!inst.destroyed) sync(inst, options, selfCaused)
    deliver(inst)
  })

  return view
}

function createInstance(options: Options): Instance {
  const inst: Instance = {
    table: undefined as unknown as AnyTable,
    destroyed: false,
    mounted: false,
    latest: options,
    synced: options,
    wrappers: {
      onStateChange: (updater) => (inst.latest.onStateChange as Callback)(updater),
      onDiagnostic: (d: Diagnostic) => {
        if (inst.rendering === 0) {
          ;(inst.latest.onDiagnostic as ((d: Diagnostic) => void) | undefined)?.(d)
          return
        }
        if (inst.queue === undefined) {
          inst.queue = []
          // Delivered by the next layout effect, or here when this render never commits.
          queueMicrotask(() => deliver(inst))
        }
        inst.queue.push(d)
      },
      fetcher: (params) => (inst.latest.fetcher as Callback)(params),
    },
    queue: undefined,
    rendering: 0,
    syncing: false,
    selfCaused: false,
    version: 0,
    view: undefined,
    seen: options,
    unstable: new Map(),
    warned: new Set(),
  }
  if (!registered) {
    registered = true
    registerPackage('@datakable/react', version)
  }
  build(inst, options)
  return inst
}

function build(inst: Instance, options: Options) {
  const init: Options = { ...options }
  for (const k of CALLBACKS) if (typeof options[k] === 'function') init[k] = inst.wrappers[k]
  inst.rendering++
  try {
    inst.table = createTable(init as never) as unknown as AnyTable
  } finally {
    inst.rendering--
  }
  inst.synced = options
  inst.seen = options
  inst.view = undefined
}

function recreate(inst: Instance) {
  build(inst, inst.latest)
  inst.destroyed = false
}

/** The view of the table's snapshot, cached on (table, state, row model, notifications). */
function snapshot(inst: Instance, table: AnyTable): object {
  inst.rendering++
  try {
    const state = table.getState()
    const rowModel = table.getRowModel()
    const v = inst.view
    if (v && v.table === table && v.version === inst.version) {
      const value = v.value as { state: unknown; rowModel: unknown }
      if (value.state === state && value.rowModel === rowModel) return value
    }
    const value = Object.create(table, {
      state: { value: state, enumerable: true },
      rowModel: { value: rowModel, enumerable: true },
    }) as object
    inst.view = { table, version: inst.version, value }
    return value
  } finally {
    inst.rendering--
  }
}

/**
 * Forwards the changed options with one `setOptions` call. In the re-render caused by that call,
 * values recomputed from the same inputs (same-shape `columns`, an equal `data` array, a `rowKey`
 * function) are not forwarded again: an inline `columns` / `data` would otherwise loop.
 */
function sync(inst: Instance, options: Options, selfCaused: boolean) {
  if (DEV) checkUnstable(inst, options)
  const prev = inst.synced
  let partial: Record<string, unknown> | undefined
  for (const k of SYNCED) {
    const v = options[k]
    const p = prev[k]
    if (Object.is(v, p)) continue
    let forward: unknown = v
    switch (k) {
      case 'onStateChange':
      case 'onDiagnostic':
      case 'fetcher': {
        const on = typeof v === 'function'
        if (on === (typeof p === 'function')) continue
        forward = on ? inst.wrappers[k] : undefined
        break
      }
      case 'state':
        if (sameSlices(v, p)) continue
        break
      case 'interceptors':
        if (sameItems(v, p)) continue
        break
      case 'data':
        // Two empty arrays hold nothing to ingest (e.g. an inline `data: []` with a fetcher).
        if ((selfCaused || isEmpty(v)) && sameItems(v, p)) continue
        break
      case 'columns':
        if (selfCaused && sameShape(v, p)) continue
        break
      case 'rowKey':
        if (selfCaused && typeof v === 'function' && typeof p === 'function') continue
        break
    }
    partial ??= {}
    partial[k] = forward
  }
  if (partial === undefined) return
  inst.syncing = true
  try {
    inst.table.setOptions(partial)
  } finally {
    inst.syncing = false
  }
  const synced = { ...prev }
  for (const k of Object.keys(partial)) synced[k] = options[k]
  inst.synced = synced
}

/** Delivers the `onDiagnostic` calls queued while rendering. */
function deliver(inst: Instance) {
  const queue = inst.queue
  if (queue === undefined) return
  inst.queue = undefined
  const sink = inst.latest.onDiagnostic as ((d: Diagnostic) => void) | undefined
  for (const d of queue) {
    try {
      sink?.(d)
    } catch (e) {
      // Like a failing sink in the hub: the logger never breaks the table.
      console.error('[DataKable] onDiagnostic threw', e)
    }
  }
}

// --- comparisons ---------------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object'

/** Controlled slices: the same defined slices, each `Object.is`-equal. */
function sameSlices(a: unknown, b: unknown): boolean {
  if (!isObject(a) || !isObject(b)) return false
  const defined = (o: Record<string, unknown>) => Object.keys(o).filter((k) => o[k] !== undefined)
  const keys = defined(a)
  if (keys.length !== defined(b).length) return false
  for (const k of keys) if (!Object.is(a[k], b[k])) return false
  return true
}

const isEmpty = (v: unknown) => Array.isArray(v) && v.length === 0

/** Two arrays with the same items (by reference). */
function sameItems(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false
  return true
}

const loose = (v: unknown) => typeof v === 'function' || isObject(v)

/**
 * Column arrays of the same shape: same length, same keys per column and equal primitive values;
 * functions and nested objects (`format`, `cell`, `filter`, …) may be new references.
 */
function sameShape(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x: unknown = a[i]
    const y: unknown = b[i]
    if (Object.is(x, y)) continue
    if (!isObject(x) || !isObject(y)) return false
    const keys = Object.keys(x)
    if (keys.length !== Object.keys(y).length) return false
    for (const k of keys) {
      if (!Object.hasOwn(y, k)) return false
      const vx = x[k]
      const vy = y[k]
      if (Object.is(vx, vy)) continue
      if (!(loose(vx) && loose(vy) && typeof vx === typeof vy)) return false
    }
  }
  return true
}

// --- dev: DK_UNSTABLE_COLUMNS / DK_UNSTABLE_OPTION -----------------------------------------------

/** The first function option of a feature that is a new reference: `features[i].<option>`. */
function changedFeatureOption(a: unknown, b: unknown): string | undefined {
  if (!Array.isArray(a) || !Array.isArray(b) || a === b) return undefined
  for (let i = 0; i < a.length; i++) {
    const f = a[i] as AnyFeature | undefined
    const g = b[i] as AnyFeature | undefined
    if (!f || !g || f === g || f.name !== g.name) continue
    if (!isOptionsDefinition(f.options) || !isOptionsDefinition(g.options)) continue
    const fv = f.options.values
    const gv = g.options.values
    if (!fv || !gv) continue
    for (const k of Object.keys(fv)) {
      if (typeof fv[k] === 'function' && fv[k] !== gv[k]) return `features[${i}].${k}`
    }
  }
  return undefined
}

/** Counts renders in a row that pass a new reference for the same thing; reports each once. */
function checkUnstable(inst: Instance, options: Options) {
  const seen = inst.seen
  inst.seen = options
  const changed = (k: string) => !Object.is(options[k], seen[k])
  const fn = (k: string) =>
    changed(k) && typeof options[k] === 'function' && typeof seen[k] === 'function'
  track(inst, 'columns', changed('columns') && sameShape(options.columns, seen.columns))
  track(inst, 'data', changed('data') && sameItems(options.data, seen.data))
  track(inst, 'fetcher', fn('fetcher'))
  track(inst, 'rowKey', fn('rowKey'))
  const option = changedFeatureOption(options.features, seen.features)
  track(inst, 'features', option !== undefined, option)
}

function track(inst: Instance, key: string, unstable: boolean, option = key) {
  const n = unstable ? (inst.unstable.get(key) ?? 0) + 1 : 0
  inst.unstable.set(key, n)
  if (n < UNSTABLE_AFTER || inst.warned.has(key)) return
  inst.warned.add(key)
  if (key === 'columns') emitTableDiagnostic(inst.table, 'DK_UNSTABLE_COLUMNS', { renders: n })
  else emitTableDiagnostic(inst.table, 'DK_UNSTABLE_OPTION', { option, renders: n })
}
