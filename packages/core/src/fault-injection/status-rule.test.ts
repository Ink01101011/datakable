import { describe, expect, it } from 'vitest'
import { createTable, defineFeature, listDiagnosticCodes } from '../index'
import { inStepDiagnosticSetsError } from '../pipeline/status-rule'
import { fail, people, useHarness } from './harness'
import { inStepScenarios } from './status-cases'

useHarness()

/**
 * §6.6 status rule, default (decided by the orchestrator pending the user's answer, R6/T30): a
 * handled cell-level problem inside a step is a diagnostic only; `'error'` is for a step that
 * throws, a failed ingest, a failed fetch or search. The flipped rule: status-rule-flipped.test.ts.
 */
describe('status rule: in-step diagnostics (default)', () => {
  it('the predicate counts no in-step diagnostic', () => {
    for (const code of listDiagnosticCodes())
      expect(inStepDiagnosticSetsError(code as never), code).toBe(false)
  })

  it.each(['typeMismatch', 'customFilter', 'accessor'] as const)(
    '%s: reported, status stays idle',
    (name) => {
      const s = inStepScenarios()
      const t = s[name]()
      expect(t.getRowModel().status).toBe('idle')
      expect(s.seen.length).toBeGreaterThan(0)
    },
  )

  it("a step that throws still sets 'error' and recovers to 'idle'", () => {
    let throwing = true
    const probe = defineFeature({
      name: 'probe',
      stage: 'filter',
      initialState: () => 0,
      createApi: () => ({}),
      rowModel: (i: Uint32Array) => (throwing ? fail() : i),
    })
    const t = createTable({ data: people(), features: [probe] })
    expect(t.getRowModel().status).toBe('error')
    throwing = false
    t.setState({ probe: 1 })
    expect(t.getRowModel().status).toBe('idle')
  })
})
