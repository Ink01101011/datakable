import { describe, expect, it, vi } from 'vitest'
import reference from './datakable-2.1.1-nonfinite.ref.json'
import { CASES, DATA, QUERIES, typed } from './test-nonfinite'

// R F2 (#123): ex-search 2.x throws on a non-finite weight or threshold; 1.2.1 scored with them. A
// minor release keeps what datakable 2.1.1 returned for these configurations in production: the
// rows, their order and the status recorded with the published `datakable@2.1.1` from npm
// (`datakable-2.1.1-nonfinite.ref.json`, `production`: the same data, cases and keystrokes, typed
// one after another on one table; test-nonfinite.ts). Development: nonfinite.test.ts.

vi.mock('../../diagnostics/env', () => ({ DEV: false }))

describe('production: a non-finite weight or threshold searches as in datakable 2.1.1 (R F2)', () => {
  it('every case: the rows, order and status of the 2.1.1 reference', async () => {
    expect(reference.queries).toEqual(QUERIES)
    const expected = reference.production as Record<string, string[]>
    expect(Object.keys(CASES)).toEqual(Object.keys(expected))
    for (const [name, c] of Object.entries(CASES)) {
      const got = await typed(c)
      const ref = expected[name] as string[]
      for (let j = 0; j < QUERIES.length; j++) {
        expect(got[j], `${name} "${QUERIES[j]}"`).toBe(ref[j])
      }
    }
  })

  it('the reference is not vacuous: an infinite weight ranks rows, a NaN threshold keeps all', () => {
    const p = reference.production as Record<string, string[]>
    expect(p['name Infinity']?.[0]).toMatch(/^idle: \d+(,\d+){5,}$/)
    expect(p['threshold NaN, name 1']?.[0]?.split(',')).toHaveLength(DATA.length)
    expect(p['threshold Infinity, name 1']?.[0]).toBe('idle: ')
  })
})
