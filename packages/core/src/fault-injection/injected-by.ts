/**
 * The fault-injection test of every diagnostic code (§8.3, §11): code → the test file that injects
 * it, relative to `packages/core/src`. Shared by the core catalog test
 * (`fault-injection/catalog.test.ts`) and the `docs/errors.md` test (`packages/datakable`), which
 * checks it against the full registry (core + `@datakable/react`). Not part of the build.
 *
 * The fault-injection suites under `fault-injection/` check the real diagnostic (code, exact
 * `where`, non-empty `fix`); other codes point at the unit test that triggers them, and that file
 * must name the code. DK_HYDRATION_MISMATCH is defined in core and emitted by `@datakable/react`
 * (its injecting test is there); the codes after the last comment are registered by
 * `@datakable/react` itself.
 */
const HARNESS = 'fault-injection/slots.test.ts'

export const injectedBy: Readonly<Record<string, string>> = {
  DK_ASYNC_TIMEOUT: 'source/async-control.test.ts',
  DK_CALLBACK_BAD_RETURN: HARNESS,
  DK_CALLBACK_FAILED: HARNESS,
  DK_COLUMN_PATH_NOT_FOUND: 'ingest/data-checks.test.ts',
  DK_COLUMN_PATH_PARTIAL: 'ingest/data-checks.test.ts',
  DK_CONTROLLED_WITHOUT_HANDLER: 'table/create-table.test.ts',
  DK_DATA_MUTATED: 'table/data-mutation.test.ts',
  DK_DEP_INCOMPATIBLE: 'versioning/versioning.test.ts',
  DK_DEPRECATED: 'versioning/versioning.test.ts',
  DK_DUPLICATE_CORE: 'versioning/versioning.test.ts',
  DK_DUPLICATE_ROW_KEY: 'ingest/row-key.test.ts',
  DK_ENV_FALLBACK: 'pipeline/env.test.ts',
  DK_FEATURE_API_CONFLICT: 'feature/feature.test.ts',
  DK_FEATURE_BAD_OUTPUT: HARNESS,
  DK_FEATURE_DUPLICATE: 'feature/feature.test.ts',
  DK_FEATURE_FAILED: HARNESS,
  DK_FEATURE_INCOMPATIBLE: 'versioning/versioning.test.ts',
  DK_FEATURE_MUTATED_INPUT: 'pipeline/dev-checks.test.ts',
  DK_FETCH_ABORTED: 'source/fetcher.test.ts',
  DK_FETCH_BAD_RESPONSE: HARNESS,
  DK_FETCH_FAILED: HARNESS,
  DK_FETCHER_WITHOUT_SERVER_MODE: 'source/fetcher.test.ts',
  DK_FILTER_TYPE_MISMATCH: 'features/column-filters/column-filters.test.ts',
  DK_HOT_INTERCEPTOR: 'intercept/runtime.test.ts',
  DK_HYDRATION_MISMATCH: '../../react/src/hydrate.test.tsx',
  DK_INCONSISTENT_ROW_SHAPE: 'ingest/data-checks.test.ts',
  DK_INTERCEPTOR_FAILED: HARNESS,
  DK_INTERNAL: 'intercept/boundary.test.ts',
  DK_INVALID_OPTION: 'catalog/options.test.ts',
  DK_INVALID_PAGINATION: 'features/pagination/pagination.test.ts',
  DK_INVALID_VALIDITY: 'features/validity/validity.test.ts',
  DK_LISTENER_FAILED: HARNESS,
  DK_MISSING_ROW_KEY: 'ingest/row-key.test.ts',
  DK_MODE_ORDER: 'source/fetcher.test.ts',
  DK_OPERATION_CONFLICT: 'intercept/boundary.test.ts',
  DK_OPTION_NO_EFFECT: 'catalog/options.test.ts',
  DK_PERF_HINT: 'pipeline/env.test.ts',
  DK_ROW_COUNT_MISSING: 'features/pagination/pagination.test.ts',
  DK_SCHEMA_CRASHED: HARNESS,
  DK_SCHEMA_INVALID_ROW: 'ingest/schema.test.ts',
  DK_SEARCH_FAILED: HARNESS,
  DK_SORT_COMPARATOR_INVALID: HARNESS,
  DK_SORT_STRATEGY: 'features/sorting/strategy.test.ts',
  DK_SSR_ASYNC_DEFERRED: 'table/ssr.test.ts',
  DK_STATE_UNKNOWN_KEY: 'features/column-filters/column-filters.test.ts',
  DK_TABLE_DESTROYED: 'table/create-table.test.ts',
  DK_UNKNOWN: 'intercept/boundary.test.ts',
  DK_UNKNOWN_OPTION: 'catalog/options.test.ts',
  DK_UNRENDERABLE_VALUE: 'pipeline/pipeline.test.ts',
  DK_UNSAFE_REDACTION: 'diagnostics/redact.test.ts',
  DK_UPDATE_LOOP: 'table/create-table.test.ts',
  DK_VERSION_MISMATCH: 'versioning/versioning.test.ts',
  // Registered by @datakable/react (not core): their injecting tests live there.
  DK_RENDER_FAILED: '../../react/src/data-table.fault.test.tsx',
  DK_UNSTABLE_COLUMNS: '../../react/src/use-data-table.test.tsx',
  DK_UNSTABLE_OPTION: '../../react/src/use-data-table.test.tsx',
}

/** Entries for codes that `@datakable/react` registers (outside the core registry). */
export const REACT_TESTS = '../../react/src/'
