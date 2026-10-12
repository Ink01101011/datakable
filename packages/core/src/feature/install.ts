import { throwConfigError } from '../diagnostics/build'
import type { Emit } from '../diagnostics/types'
import { errorName } from '../intercept/classify'
import type { Table, TableState } from '../table/types'
import { featureDiagnostics } from './codes'
import type { AnyFeature, FeatureContext, SliceUpdater } from './types'

void featureDiagnostics

/** What `createTable` gives the installer: the store operations a feature context needs. */
export interface FeatureHost {
  readonly table: Table<unknown, TableState>
  /** The table name, for config errors thrown before the first emit. */
  readonly tableName: string
  readonly emit: Emit
  getSlice(name: string): unknown
  /** `state:dispatch` of one slice (where = the feature name); notifies unless inside an API call. */
  setSlice(name: string, updater: SliceUpdater<unknown>): void
  /**
   * Runs an API method: no-op + `DK_TABLE_DESTROYED` after destroy (returning `destroyed?.()`),
   * trigger `api:<method>`, listeners notified once when the outermost call returns.
   */
  call(method: string, fn: () => unknown, destroyed?: () => unknown): unknown
}

function reportFailure(
  emit: Emit,
  feature: string,
  hook: 'initialState' | 'createApi',
  fallback: string,
  e: unknown,
) {
  const name = errorName(e)
  emit(
    'DK_FEATURE_FAILED',
    { feature, hook, fallback, ...(name === undefined ? {} : { errorName: name }) },
    { cause: e },
  )
}

/**
 * The starting snapshot: each feature's `initialState()` under its name, then `given`
 * (`options.initialState`) per slice on top. `initialState()` is not called for a given slice.
 */
export function initialSlices(
  features: readonly AnyFeature[],
  given: object | undefined,
  emit: Emit,
): TableState {
  const out: TableState = {}
  for (const f of features) {
    if (given && Object.hasOwn(given, f.name)) continue
    try {
      out[f.name] = f.initialState()
    } catch (e) {
      out[f.name] = undefined
      reportFailure(emit, f.name, 'initialState', 'the slice starts as undefined', e)
    }
  }
  return given ? Object.assign(out, given) : out
}

/**
 * Creates every feature API (in the order the features were listed) and merges it onto the table.
 * Throws `DatakableConfigError` `DK_FEATURE_API_CONFLICT` when a member name is already taken by a
 * core table method or by an earlier feature. Methods are wrapped once here (cold path).
 */
export function installApis(features: readonly AnyFeature[], host: FeatureHost): void {
  const target = host.table as unknown as Record<string, unknown>
  const owners = new Map<string, string | null>()
  for (const k of Object.keys(target)) owners.set(k, null)

  for (const f of features) {
    const name = f.name
    const ctx: FeatureContext<unknown> = {
      name,
      getState: () => host.getSlice(name),
      setState: (updater) => host.setSlice(name, updater),
      table: host.table,
      emit: host.emit,
    }
    let api: unknown
    try {
      api = f.createApi(ctx)
    } catch (e) {
      reportFailure(host.emit, name, 'createApi', 'its API was not installed', e)
      continue
    }
    if (api === null || typeof api !== 'object') continue
    const members = api as Record<string, unknown>
    const keys = Object.keys(members)
    for (const method of keys) {
      if (owners.has(method)) {
        throwConfigError(
          'DK_FEATURE_API_CONFLICT',
          { method, feature: name, owner: owners.get(method) ?? null },
          { table: host.tableName },
        )
      }
    }
    for (const method of keys) {
      owners.set(method, name)
      const member = members[method]
      const destroyed = f.destroyedResult?.[method]
      target[method] =
        typeof member === 'function'
          ? (...args: unknown[]) => host.call(method, () => member.apply(members, args), destroyed)
          : member
    }
  }
}
