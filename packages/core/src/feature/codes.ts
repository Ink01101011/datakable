import { defineDiagnostic } from '../diagnostics/catalog'

declare module '../diagnostics/catalog' {
  interface DiagnosticCatalog {
    DK_FEATURE_DUPLICATE: {
      feature: string
      /** Positions in `options.features` of the first and the repeated entry. */
      first: number
      second: number
    }
    DK_FEATURE_API_CONFLICT: {
      method: string
      /** The feature whose API was installed last (the one rejected). */
      feature: string
      /** Who already owns `method`: another feature's name, or `null` for the table itself. */
      owner: string | null
    }
    DK_FEATURE_FAILED: {
      feature: string
      /** The hook that threw. `rowModel` is reported by the pipeline runner (T09). */
      hook: 'initialState' | 'createApi' | 'rowModel'
      /** The fallback that was applied. */
      fallback: string
      /** `error.name` only; the full error is `context.cause`. */
      errorName?: string
    }
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Codes owned by the feature contract (§3.3, §8.3). */
export const featureDiagnostics = [
  defineDiagnostic({
    code: 'DK_FEATURE_DUPLICATE',
    level: 'error',
    config: true,
    where: (d) => ({ kind: 'feature', name: d.feature }),
    problem: (d) =>
      `feature "${d.feature}" is installed twice (features[${d.first}] and features[${d.second}]); ` +
      'a feature name is its state slice key and must be unique per table',
    impact: () => 'the table was not created',
    fix: (d) => [
      `remove features[${d.second}] (or features[${d.first}]): pass "${d.feature}" once, with all ` +
        'its options in one call',
      'for two different features that share a name, rename one: defineFeature({ name: ... })',
    ],
  }),
  defineDiagnostic({
    code: 'DK_FEATURE_API_CONFLICT',
    level: 'error',
    config: true,
    where: (d) => ({ kind: 'feature', name: d.feature }),
    problem: (d) =>
      `feature "${d.feature}" exposes "${d.method}", which ` +
      (d.owner === null
        ? 'the table already has (a core table method)'
        : `feature "${d.owner}" already exposes`),
    impact: () => 'the table was not created: one of the two methods would be unreachable',
    fix: (d) => [
      `namespace the method in feature "${d.feature}": ` +
        `${d.feature}${capitalize(d.method)}() or ${d.feature}.${d.method}()`,
      d.owner === null
        ? `core table methods cannot be replaced; use an interceptor (e.g. on state:dispatch) to ` +
          `change what table.${d.method}() does`
        : `or rename it in feature "${d.owner}", or install only one of the two features`,
    ],
  }),
  defineDiagnostic({
    code: 'DK_FEATURE_FAILED',
    level: 'error',
    where: (d) => ({ kind: 'feature', name: d.feature }),
    problem: (d) =>
      `feature "${d.feature}" ${d.hook}() threw${d.errorName ? ` ${d.errorName}` : ''}`,
    impact: (d) => `${d.fallback}; the rest of the table is unaffected`,
    fix: (d) => [
      `fix ${d.hook}() of feature "${d.feature}": it must not throw` +
        (d.hook === 'rowModel' ? ' (return its input indices when it cannot filter)' : ''),
      'the original error is context.cause (passed to onDiagnostic)',
    ],
  }),
]
