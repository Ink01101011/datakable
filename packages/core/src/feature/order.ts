import { throwConfigError } from '../diagnostics/build'
import { keepDiagnostics } from '../diagnostics/catalog'
import { featureDiagnostics } from './codes'
import type { AnyFeature, Stage } from './types'

keepDiagnostics(featureDiagnostics)

/**
 * Pipeline order of the stages (§3.3): `ingest → filter → search → sort → paginate`. Filter runs
 * before search because fuzzy search is the most expensive step; the resulting set is the same.
 * `'none'` features have no `rowModel` step and come last.
 */
export const STAGES: readonly Stage[] = ['filter', 'search', 'sort', 'paginate', 'none']

const rank = (stage: Stage): number => {
  const r = STAGES.indexOf(stage)
  return r === -1 ? STAGES.length : r
}

/**
 * The features in pipeline order (stable within a stage, so `[columnFilters(), validity()]` keeps
 * that order). Throws `DatakableConfigError` `DK_FEATURE_DUPLICATE` when two share a `name`.
 * `table` names the table in the error's context.
 */
export function orderFeatures(
  features: readonly AnyFeature[],
  table?: string,
): readonly AnyFeature[] {
  const seen = new Map<string, number>()
  for (let i = 0; i < features.length; i++) {
    const name = (features[i] as AnyFeature).name
    const first = seen.get(name)
    if (first !== undefined) {
      throwConfigError(
        'DK_FEATURE_DUPLICATE',
        { feature: name, first, second: i },
        table === undefined ? {} : { table },
      )
    }
    seen.set(name, i)
  }
  // Array#sort is stable (ES2019).
  return [...features].sort((a, b) => rank(a.stage) - rank(b.stage))
}
