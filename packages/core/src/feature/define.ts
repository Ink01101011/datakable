import { explainDetail } from '../diagnostics/explain-detail'
import { createColumnCache } from '../pipeline/column-cache'
import { createSlicer } from '../pipeline/slice'
import { initialSlices, installApis } from './install'
import { orderFeatures } from './order'
import { featureRuntime } from './runtime'
import type {
  AnyRow,
  Feature,
  FeatureContext,
  FeatureTypes,
  FixedTypes,
  RowModelContext,
} from './types'

// Features bring their runtime (§3.3, changed 2026-10-13 for §9.3): loading defineFeature installs
// it, so a table without features never bundles it.
featureRuntime.current ??= {
  orderFeatures,
  initialSlices,
  installApis,
  createColumnCache,
  createSlicer,
  explainDetail,
}

/** A feature whose state `S` and API `A` do not depend on the row type (inferred). */
export interface FixedFeatureDefinition<Name extends string, S, A>
  extends Omit<
    Feature<Name, FixedTypes<S, A>>,
    '_types' | 'initialState' | 'createApi' | 'rowModel'
  > {
  initialState: () => S
  createApi: (ctx: FeatureContext<S>) => A
  rowModel?: (indices: Uint32Array, state: S, ctx: RowModelContext<AnyRow>) => Uint32Array
}

/**
 * Defines a feature (§3.3). Identity at runtime; it exists for typing.
 *
 * Row-typed feature (all built-ins): declare the types interface and pass both type arguments.
 *
 * ```ts
 * interface SortingTypes extends FeatureTypes { state: SortState<this['T']>; api: SortApi<this['T']> }
 * export const sorting = (opts: SortingOptions = {}) =>
 *   defineFeature<'sorting', SortingTypes>({ name: 'sorting', stage: 'sort', ... })
 * ```
 *
 * Feature that does not depend on `T`: no type arguments, state and API are inferred.
 */
export function defineFeature<const Name extends string, S, A extends object>(
  definition: FixedFeatureDefinition<Name, S, A>,
): Feature<Name, FixedTypes<S, A>>
export function defineFeature<const Name extends string, F extends FeatureTypes>(
  definition: Feature<Name, F>,
): Feature<Name, F>
export function defineFeature(definition: Feature): Feature {
  return definition
}
