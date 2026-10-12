import { describe, expect, it } from 'vitest'
import {
  buildDiagnostic,
  DatakableConfigError,
  DatakableError,
  formatWhere,
  throwConfigError,
} from './build'
import { defineDiagnostic, getDiagnosticDefinition, listDiagnosticCodes } from './catalog'
import { coreDiagnostics } from './codes'

declare module './catalog' {
  interface DiagnosticCatalog {
    DK_TEST_CATALOG: { column: string; index: number }
  }
}

const sampleDetails: Record<string, Record<string, unknown>> = {
  DK_INTERCEPTOR_FAILED: { interceptor: 'audit', op: 'state:dispatch', slot: 'setState' },
  DK_HOT_INTERCEPTOR: { interceptor: 'perf', op: 'column:batch' },
  DK_OPERATION_CONFLICT: {
    op: 'x:y',
    kind: 'async',
    hot: false,
    previousKind: 'sync',
    previousHot: true,
  },
  DK_INTERNAL: { op: 'pipeline:run', problem: 'Unknown operation "pipeline:run"' },
}

describe('diagnostic catalog', () => {
  it('registers a definition and looks it up by code', () => {
    const def = defineDiagnostic({
      code: 'DK_TEST_CATALOG',
      level: 'warn',
      where: (d) => ({ kind: 'column', index: d.index, id: d.column }),
      problem: (d) => `column "${d.column}" is odd`,
      impact: () => 'nothing breaks',
      fix: (d) => [`rename "${d.column}"`],
    })
    expect(getDiagnosticDefinition('DK_TEST_CATALOG')).toBe(def)
    expect(listDiagnosticCodes()).toContain('DK_TEST_CATALOG')
    // Same code, same level: replaced (module re-evaluation / HMR).
    expect(() => defineDiagnostic({ ...def })).not.toThrow()
    // A code is never redefined with another meaning.
    expect(() => defineDiagnostic({ ...def, level: 'error' })).toThrow(/DK_TEST_CATALOG/)
  })

  it('every core code has a non-empty where, problem, impact and fix', () => {
    expect(coreDiagnostics.map((d) => d.code).sort()).toEqual(Object.keys(sampleDetails).sort())
    for (const def of coreDiagnostics) {
      const details = sampleDetails[def.code]
      expect(details, def.code).toBeDefined()
      const d = buildDiagnostic(def.code, details as never)
      expect(d.code).toBe(def.code)
      expect(formatWhere(d.where).length, def.code).toBeGreaterThan(0)
      expect(d.problem.length, def.code).toBeGreaterThan(0)
      expect(d.impact.length, def.code).toBeGreaterThan(0)
      expect(d.fix.length, def.code).toBeGreaterThan(0)
      expect(
        d.fix.every((f) => f.length > 0),
        def.code,
      ).toBe(true)
      expect(d.docs).toMatch(new RegExp(`errors\\.md.*#${def.code.toLowerCase()}$`))
    }
  })

  it('throwConfigError throws a DatakableConfigError with the diagnostic shape', () => {
    let caught: unknown
    try {
      throwConfigError('DK_OPERATION_CONFLICT', sampleDetails.DK_OPERATION_CONFLICT as never)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(DatakableConfigError)
    expect(caught).toBeInstanceOf(DatakableError)
    const e = caught as DatakableConfigError
    expect(e.code).toBe('DK_OPERATION_CONFLICT')
    expect(e.message).toMatch(/^DK_OPERATION_CONFLICT: /)
    expect(e.message).toMatch(/already registered/)
    expect(e.fix.length).toBeGreaterThan(0)
    expect(e.where).toEqual({ kind: 'operation', op: 'x:y' })
    expect(e.docs).toMatch(/#dk_operation_conflict$/)
    expect(e.diagnostic.context.table).toBe('(global)')
  })
})
