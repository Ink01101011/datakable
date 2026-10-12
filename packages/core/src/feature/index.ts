/**
 * Feature contract (spec §3.3). Built-in features (columnFilters, validity, search, sorting,
 * pagination) and third-party ones (selection, Spec 2) use exactly this contract.
 *
 * Writing a feature — one file, nothing to change in `createTable`:
 *
 * ```ts
 * // 1. Hoisted generic shapes over the row type (TS2526 forbids `this` in nested literals).
 * export type SortState<T> = { by: { key: Path<T>; desc: boolean }[] }
 * export type SortApi<T> = { toggleSort(key: Path<T>): void }
 *
 * // 2. The type-lambdas: `this['T']` is replaced by the table's row type.
 * export interface SortingTypes extends FeatureTypes {
 *   state: SortState<this['T']>
 *   api: SortApi<this['T']>
 * }
 *
 * // 3. A factory (options close over the definition).
 * export const sorting = (opts: SortingOptions = {}) =>
 *   defineFeature<'sorting', SortingTypes>({
 *     name: 'sorting',               // state slice key, unique per table (DK_FEATURE_DUPLICATE)
 *     stage: 'sort',                 // pipeline position (STAGES); 'none' = state/API only
 *     initialState: () => ({ by: [] }),
 *     createApi: (ctx) => ({         // merged onto the table (DK_FEATURE_API_CONFLICT on clashes)
 *       toggleSort: (key) => ctx.setState((s) => ({ by: [{ key, desc: !s.by[0]?.desc }] })),
 *     }),
 *     rowModel: (indices, state, ctx) => sortIndices(indices, state, ctx.data),
 *   })
 * ```
 *
 * `createTable({ data: users, features: [sorting(), pagination()] })` is then typed with
 * `StateOf` / `ApiOf`: `table.toggleSort('name')` checks the key against `User`,
 * `table.getState().sorting` exists, and APIs / slices of uninstalled features are compile errors.
 * A feature whose state and API do not depend on `T` can skip the interface:
 * `defineFeature({ name, stage, initialState, createApi })` infers both.
 *
 * Runtime rules (`createTable`):
 * - Features are read once, at creation. `options.initialState[name]` replaces `initialState()`;
 *   controlled slices (`options.state[name]`) follow the store's rules (§3.2).
 * - `ctx.setState` replaces the feature's own slice through `state:dispatch` (`where` = feature
 *   name). API methods are wrapped once: trigger `api:<method>`, listeners notified once when the
 *   outermost call returns, no-op + `DK_TABLE_DESTROYED` after `destroy()`.
 * - Pipeline order is by `stage` (`orderFeatures`, stable within a stage): filter → search → sort →
 *   paginate. The runner (T09) gets the ordered list from the table internals seam.
 * - `rowModel` must be pure: return kept indices (new array or subarray), never mutate `indices`.
 * - Feature `interceptors` are installed after asyncControl and before the user's interceptors.
 * - `initialState()` / `createApi()` throwing → `DK_FEATURE_FAILED` (slice `undefined` / API not
 *   installed); the table is still created. Duplicates and API clashes are config errors (thrown).
 */
export { featureDiagnostics } from './codes'
export { defineFeature, type FixedFeatureDefinition } from './define'
export { orderFeatures, STAGES } from './order'
export type {
  AnyFeature,
  ApiOf,
  Apply,
  Feature,
  FeatureContext,
  FeatureTypes,
  FixedTypes,
  RowModelContext,
  SliceUpdater,
  Stage,
  StateOf,
  TableStateFor,
} from './types'
