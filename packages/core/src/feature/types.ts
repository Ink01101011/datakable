import type { OptionsDefinition } from '../catalog/options'
import type { Emit } from '../diagnostics/types'
import type { Interceptor } from '../intercept/define'
import type { OpName } from '../intercept/operations'
import type { Table, TableState } from '../table/types'

// --- HKT-lite (ported from the brainstorm prototype `typeproto/feat.ts`) --------------------------

/**
 * Type-lambdas over the row type `T`. A feature declares an interface that extends this and writes
 * `state` / `api` in terms of `this['T']`; {@link Apply} substitutes the real row type later:
 *
 * ```ts
 * interface SortingTypes extends FeatureTypes {
 *   state: SortState<this['T']>
 *   api: SortApi<this['T']>
 * }
 * ```
 *
 * The shapes must be hoisted generic types (`SortState<T>`): `this` inside a nested object
 * literal type is TS2526.
 */
export interface FeatureTypes {
  readonly T: unknown
  state: unknown
  api: unknown
}

/** `F`'s `state` or `api` with the row type `T` substituted for `this['T']`. */
export type Apply<F extends FeatureTypes, T, K extends 'state' | 'api'> = (F & { readonly T: T })[K]

/**
 * Pipeline stage of a feature's `rowModel` (§3.3). Steps run in {@link STAGES} order:
 * `ingest → filter → search → sort → paginate`; `'none'` features take no part in the row model
 * (state + API only, e.g. selection).
 */
export type Stage = 'filter' | 'search' | 'sort' | 'paginate' | 'none'

// --- contexts ------------------------------------------------------------------------------------

/** Replaces the feature's slice: a new value, or a function of the current one. */
export type SliceUpdater<S> = S | ((prev: S) => S)

/** What `createApi` receives. One per feature per table, created once at `createTable`. */
export interface FeatureContext<S = unknown> {
  /** The feature's `name` (= its state slice key). */
  readonly name: string
  /** The current value of the feature's own slice (controlled value if the slice is controlled). */
  getState(): S
  /**
   * Sets the feature's own slice through `state:dispatch`, like `table.setState({ [name]: v })`:
   * controlled slices go to `onStateChange`, the update-loop guard applies, and after `destroy()`
   * it is a no-op. Listeners are notified once the outermost API call returns.
   */
  setState(updater: SliceUpdater<S>): void
  /** The table (whole state, `subscribe`, other features' APIs). */
  readonly table: Table<unknown, TableState>
  /** Emits a catalog diagnostic on the table's hub. */
  readonly emit: Emit
}

/**
 * The third argument of `rowModel`. The pipeline runner (T09) fills it and may add members.
 */
export interface RowModelContext<T = unknown> {
  /** The feature's `name`. */
  readonly name: string
  /** The ingested rows; `indices` point into this array. */
  readonly data: readonly T[]
  readonly emit: Emit
}

// --- the feature contract ------------------------------------------------------------------------

/** The row type a feature's runtime members see: a feature is written once for every `T`. */
// biome-ignore lint/suspicious/noExplicitAny: features are row-type agnostic at runtime
export type AnyRow = any

/**
 * A feature (§3.3). Built-ins and third-party features use exactly this contract. `F` carries the
 * row-typed state / API shapes; the runtime members see them with `T = any` because a feature is
 * written once for every row type.
 */
export interface Feature<Name extends string = string, F extends FeatureTypes = FeatureTypes> {
  /** State slice key; must be unique per table (`DK_FEATURE_DUPLICATE`). */
  readonly name: Name
  /** Where `rowModel` runs in the pipeline; `'none'` for state/API-only features. */
  readonly stage: Stage
  /** Phantom: carries `F` for {@link StateOf} / {@link ApiOf}. Never set at runtime. */
  readonly _types?: F
  /**
   * The feature's options: `defineOptions(schema, factoryOptions)`. `createTable` checks the values
   * against the schema (`DK_UNKNOWN_OPTION`, `DK_INVALID_OPTION`, `DK_OPTION_NO_EFFECT`).
   */
  readonly options?: OptionsDefinition
  /** Fresh starting value of the slice; `options.initialState[name]` takes precedence. */
  initialState: () => Apply<F, AnyRow, 'state'>
  /**
   * Builds the API merged onto the table. Methods are wrapped once (trigger `api:<method>`, no-op +
   * `DK_TABLE_DESTROYED` after destroy); a name already taken by the table or another feature is
   * `DK_FEATURE_API_CONFLICT`.
   */
  createApi: (ctx: FeatureContext<Apply<F, AnyRow, 'state'>>) => Apply<F, AnyRow, 'api'>
  /**
   * Pure step over row indices: returns the kept indices in output order (a new array or a
   * subarray; never mutate `indices`). Memoised by the runner on (input reference, own slice).
   */
  rowModel?: (
    indices: Uint32Array,
    state: Apply<F, AnyRow, 'state'>,
    ctx: RowModelContext<AnyRow>,
  ) => Uint32Array
  /** Interceptors this feature contributes (installed after asyncControl, before the user's). */
  readonly interceptors?: readonly Interceptor<OpName>[]
  /** Semver range of `@datakable/core` the feature needs (`DK_FEATURE_INCOMPATIBLE`, T28). */
  readonly requires?: { readonly core: string }
}

/** Any feature, for lists and constraints. */
// biome-ignore lint/suspicious/noExplicitAny: `any` keeps every Feature<N, F> assignable here
export type AnyFeature = Feature<string, any>

/** The types of a feature defined without HKT (its state and API do not depend on `T`). */
export interface FixedTypes<S, A> extends FeatureTypes {
  state: S
  api: A
}

// --- installed features → table types ------------------------------------------------------------

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (
  x: infer I,
) => void
  ? I
  : never

/**
 * `{ [name]: state }` of the installed features, with `T` applied. A slice of a feature that is
 * not installed is absent (accessing it is a compile error). `unknown` for no features, and for a
 * non-tuple list (`readonly AnyFeature[]`, e.g. options forwarded by a wrapper): nothing is known
 * about its slices, and `AnyFeature`'s `any` types must not turn the whole table into `any`.
 */
export type StateOf<Fs extends readonly AnyFeature[], T> = number extends Fs['length']
  ? unknown
  : UnionToIntersection<
      {
        [I in keyof Fs]: Fs[I] extends Feature<infer N, infer F>
          ? { [K in N]: Apply<F, T, 'state'> }
          : never
      }[number]
    >

/**
 * The merged APIs of the installed features, with `T` applied: methods of uninstalled features are
 * absent and parameters are typed against `T` (`toggleSort('nope')` is a compile error).
 * `unknown` for a non-tuple list, like {@link StateOf}.
 */
export type ApiOf<Fs extends readonly AnyFeature[], T> = number extends Fs['length']
  ? unknown
  : UnionToIntersection<
      {
        [I in keyof Fs]: Fs[I] extends Feature<string, infer F> ? Apply<F, T, 'api'> : never
      }[number]
    >

/**
 * The state type of a table: the explicit `S` (if given) plus the installed slices. Without
 * features (or with a non-tuple list) and without `S` it stays the open `TableState`.
 */
export type TableStateFor<S, Fs extends readonly AnyFeature[], T> = [S] extends [never]
  ? Fs extends readonly []
    ? TableState
    : number extends Fs['length']
      ? TableState
      : StateOf<Fs, T> & {}
  : S & StateOf<Fs, T>
