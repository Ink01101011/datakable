import { describe, expect, it, vi } from 'vitest'
import { useHarness } from './harness'
import { inStepScenarios } from './status-cases'

/**
 * The plumbing behind the §6.6 status rule, with the predicate flipped to "every in-step
 * diagnostic sets 'error'" (the other answer to the open R6 question): proves that changing
 * `inStepDiagnosticSetsError` alone applies the answer — the status is 'error' while the problem
 * persists (also on later runs: flagged steps are not memoised, flagged column cache entries
 * re-flag on every read) and clears once it is gone.
 */
vi.mock('../pipeline/status-rule', () => ({ inStepDiagnosticSetsError: () => true }))

useHarness()

describe('status rule flipped: every in-step diagnostic sets error', () => {
  it("DK_FILTER_TYPE_MISMATCH → 'error'; removing the filter → 'idle'", () => {
    const t = inStepScenarios().typeMismatch()
    expect(t.getRowModel().status).toBe('error')
    t.setState({ unrelated: 1 })
    expect(t.getRowModel().status).toBe('error')
    t.setColumnFilter('n', undefined)
    expect(t.getRowModel().status).toBe('idle')
  })

  it("a throwing custom filter fn → 'error' on every run until replaced", () => {
    const t = inStepScenarios().customFilter()
    expect(t.getRowModel().status).toBe('error')
    t.setState({ unrelated: 1 })
    expect(t.getRowModel().status).toBe('error')
    t.setColumnFilter('n', { type: 'custom', fn: () => true })
    expect(t.getRowModel().status).toBe('idle')
  })

  it("a throwing accessor read by the sort step → 'error' while the column is sorted", () => {
    const t = inStepScenarios().accessor()
    expect(t.getRowModel().status).toBe('error')
    // The column cache holds the failed values: a later read re-flags them.
    t.toggleSort('calc')
    expect(t.getRowModel().status).toBe('error')
    t.clearSorting()
    expect(t.getRowModel().status).toBe('idle')
  })
})
