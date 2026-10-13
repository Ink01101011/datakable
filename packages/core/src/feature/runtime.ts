import type { explainDetail } from '../diagnostics/explain-detail'
import type { createColumnCache } from '../pipeline/column-cache'
import type { createSlicer } from '../pipeline/slice'
import type { initialSlices, installApis } from './install'
import type { orderFeatures } from './order'

/**
 * What features bring to the table they are installed in (§3.3, changed 2026-10-13 for §9.3): the
 * stage ordering and API install, the column cache and time-slicing of the pipeline steps, and the
 * step details of `explainRow`. Calling `defineFeature` (every built-in feature does) installs it,
 * so a table without features does not bundle it.
 */
export interface FeatureRuntime {
  readonly orderFeatures: typeof orderFeatures
  readonly initialSlices: typeof initialSlices
  readonly installApis: typeof installApis
  readonly createColumnCache: typeof createColumnCache
  readonly createSlicer: typeof createSlicer
  readonly explainDetail: typeof explainDetail
}

/** Set by `defineFeature` and when `feature/define.ts` loads (module-scoped, as the catalogs). */
export const featureRuntime: { current?: FeatureRuntime | undefined } = {}

/** The runtime for `features`: `undefined` without features; throws when none was loaded. */
export function runtimeFor(features: readonly unknown[]): FeatureRuntime | undefined {
  if (features.length === 0) return undefined
  const rt = featureRuntime.current
  if (!rt) {
    throw new TypeError(
      '[DataKable] options.features is set but no feature runtime is loaded: create features with ' +
        "defineFeature() from '@datakable/core' (every built-in feature does)",
    )
  }
  return rt
}
