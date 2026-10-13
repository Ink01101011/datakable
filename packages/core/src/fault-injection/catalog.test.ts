import { describe, expect, it } from 'vitest'
import { getDiagnosticDefinition, listDiagnosticCodes } from '../index'
import { injectedBy, REACT_TESTS } from './injected-by'

/**
 * Catalog completeness (§8.3, §11; R6 carry-over): every code registered through the public index
 * has a full definition and at least one test that injects it (`injected-by.ts`: the suites here
 * check the real diagnostic; other codes point at the unit test that triggers them, and that file
 * must name the code). A new code with no entry fails this test. `docs/errors.md` (one section and
 * anchor per code, with a verified example) is checked by `packages/datakable/src/errors-doc.test.tsx`
 * against the full registry, core + `@datakable/react` (DK_RENDER_FAILED, DK_UNSTABLE_COLUMNS,
 * DK_UNSTABLE_OPTION are registered there; DK_HYDRATION_MISMATCH is defined in core and emitted by
 * `@datakable/react`).
 */

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
    // Codes @datakable/react registers are checked against its registry by the errors.md test.
    const stale = Object.entries(injectedBy).filter(
      ([c, file]) => !codes.includes(c) && !file.startsWith(REACT_TESTS),
    )
    expect(stale).toEqual([])
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
