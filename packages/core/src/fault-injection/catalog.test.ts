import { describe, expect, it } from 'vitest'
import { getDiagnosticDefinition, listDiagnosticCodes } from '../index'

/**
 * Catalog completeness (§8.3, §11; R6 carry-over): every code registered through the public index
 * has a full definition and at least one test that injects it. The fault-injection suites here
 * check the real diagnostic (code, exact `where`, non-empty `fix`); other codes point at the unit
 * test that triggers them, and that file must name the code. A new code with no entry fails this
 * test. `docs/errors.md` anchors are T38's check, on top of this one.
 *
 * §8.3 codes not registered by core yet (no entry needed until they are): DK_UNSTABLE_COLUMNS,
 * DK_RENDER_FAILED (react). DK_HYDRATION_MISMATCH is defined in core and emitted by
 * `@datakable/react` (its injecting test is there).
 */
const HARNESS = 'fault-injection/slots.test.ts'

/** Code → the test file (under packages/core/src) that injects it. */
const injectedBy: Record<string, string> = {
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
}

/** §8.3 `error (config)` codes: thrown as `DatakableConfigError` at creation. */
const CONFIG = [
  'DK_INVALID_OPTION',
  'DK_MODE_ORDER',
  'DK_FETCHER_WITHOUT_SERVER_MODE',
  'DK_FEATURE_DUPLICATE',
  'DK_FEATURE_API_CONFLICT',
  'DK_FEATURE_INCOMPATIBLE',
  // Not in the §8.3 table: a conflicting `registerOperation` (intercept/operations.ts).
  'DK_OPERATION_CONFLICT',
]

// The core tsconfig has no Node types: `node:fs` is loaded untyped.
const fs = (await import('node:fs' as string)) as {
  readFileSync(path: URL, encoding: 'utf8'): string
}
const read = (file: string) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

const codes = listDiagnosticCodes().filter((c) => !c.startsWith('DK_TEST_'))

describe('diagnostic catalog completeness', () => {
  it('every registered code has a test entry (a new code needs one)', () => {
    expect(codes.filter((c) => !(c in injectedBy))).toEqual([])
  })

  it('every entry is a registered code (no stale entries)', () => {
    expect(Object.keys(injectedBy).filter((c) => !codes.includes(c))).toEqual([])
  })

  it.each(Object.entries(injectedBy))('%s is injected by %s', (code, file) => {
    expect(read(file)).toMatch(new RegExp(`\\b${code}\\b`))
  })

  it.each(codes)('%s has a full definition', (code) => {
    const def = getDiagnosticDefinition(code)
    expect(def?.code).toBe(code)
    expect(['error', 'warn', 'info']).toContain(def?.level)
    for (const builder of ['where', 'problem', 'impact', 'fix'] as const) {
      expect(typeof def?.[builder], builder).toBe('function')
    }
    expect(def?.config === true, 'config flag').toBe(CONFIG.includes(code))
  })
})
