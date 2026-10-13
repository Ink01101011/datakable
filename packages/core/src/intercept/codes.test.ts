import { describe, expect, it } from 'vitest'
import { buildDiagnostic, formatWhere } from '../diagnostics/build'
import { getDiagnosticDefinition } from '../diagnostics/catalog'
import { boundaryDiagnostics } from './codes'

const samples: Record<string, Record<string, unknown>> = {
  DK_CALLBACK_FAILED: {
    slot: 'columns[2].format',
    column: 'price',
    rows: [4, 9],
    count: 12,
    fallback: "the failed cells render ''",
    errorName: 'TypeError',
  },
  DK_UNKNOWN: {
    op: 'pipeline:step',
    slot: 'features.sorting',
    errorName: 'TypeError',
    fallback: 'the step passed its input through',
  },
}

describe('boundary diagnostic codes', () => {
  it('are in the catalog with non-empty where, problem, impact and fix', () => {
    expect(boundaryDiagnostics.map((d) => d.code).sort()).toEqual(Object.keys(samples).sort())
    for (const def of boundaryDiagnostics) {
      expect(getDiagnosticDefinition(def.code)).toBe(def)
      const d = buildDiagnostic(def.code, samples[def.code] as never, { dev: true })
      expect(d.level, def.code).toBe('error')
      expect(formatWhere(d.where).length, def.code).toBeGreaterThan(0)
      expect(d.problem.length, def.code).toBeGreaterThan(0)
      expect(d.impact.length, def.code).toBeGreaterThan(0)
      expect(d.fix.length, def.code).toBeGreaterThan(0)
    }
  })

  it('DK_CALLBACK_FAILED names the slot, column, count and sample rows', () => {
    const d = buildDiagnostic('DK_CALLBACK_FAILED', samples.DK_CALLBACK_FAILED as never, {
      dev: true,
    })
    expect(d.where).toEqual({ kind: 'option', path: 'columns[2].format' })
    expect(d.problem).toMatch(/columns\[2\]\.format/)
    expect(d.problem).toMatch(/"price"/)
    expect(d.problem).toMatch(/12 rows/)
    expect(d.problem).toMatch(/#4, #9/)
    expect(d.impact).toMatch(/render ''/)
    expect(d.fingerprint).toBe('DK_CALLBACK_FAILED@options.columns[2].format')
  })

  it('DK_INTERNAL accepts the boundary details (slot, errorName, fallback) and links an issue', () => {
    const d = buildDiagnostic(
      'DK_INTERNAL',
      {
        op: 'pipeline:run',
        problem: 'x',
        slot: 'pipeline',
        errorName: 'TypeError',
        fallback: 'kept',
      },
      { dev: true },
    )
    expect(d.where).toEqual({ kind: 'operation', op: 'pipeline:run', slot: 'pipeline' })
    expect(formatWhere(d.where)).toBe('operation pipeline:run at pipeline')
    expect(d.impact).toMatch(/kept/)
    expect(d.fix.some((f) => /issues\/new\?title=/.test(f))).toBe(true)
  })

  it('DK_INTERNAL keeps its minimal form (invariant callers)', () => {
    const d = buildDiagnostic(
      'DK_INTERNAL',
      { op: 'x:y', problem: 'Unknown operation' },
      { dev: true },
    )
    expect(d.where).toEqual({ kind: 'operation', op: 'x:y' })
    expect(d.problem).toMatch(/Unknown operation/)
    expect(d.impact).toMatch(/aborted/)
  })
})
