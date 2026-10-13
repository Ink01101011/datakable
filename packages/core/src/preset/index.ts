import { columnFilters } from '../features/column-filters/column-filters'
import { pagination } from '../features/pagination/pagination'
import { search } from '../features/search/search'
import { sorting } from '../features/sorting/sorting'
import { validity } from '../features/validity/validity'

/**
 * Fresh instances of the default preset (§3.3), in pipeline order. Each call returns new feature
 * instances, so two tables never share a feature's memo (search index, sort caches).
 */
export const createDefaultFeatures = () =>
  [columnFilters(), validity(), search(), sorting(), pagination()] as const

/** The default preset's feature tuple: `typeof defaultFeatures`. */
export type DefaultFeatures = ReturnType<typeof createDefaultFeatures>

/**
 * The default preset (§3.3): `[columnFilters(), validity(), search(), sorting(), pagination()]`.
 * `datakable`'s `createTable` installs it when `features` is omitted; core's `createTable` installs
 * nothing by default, so importing it alone stays small (§9.3). Pass `features: defaultFeatures`
 * to opt in with core. Passing `features` replaces the preset entirely.
 */
export const defaultFeatures: DefaultFeatures = /* @__PURE__ */ createDefaultFeatures()
