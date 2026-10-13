import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from '../diagnostics/types'
import { defineFeature } from '../feature/define'
import type { AnyFeature } from '../feature/types'
import { createTable } from '../table/create-table'
import { indexPrint } from './dev-checks'

/** Dev checks around `rowModel` (§3.4 devChecks, §8.3): bad output and mutated input. */

let seen: Diagnostic[]
const onDiagnostic = (d: Diagnostic) => {
  seen.push(d)
}
const codes = () => seen.map((d) => d.code)
const only = (code: string) => {
  const d = seen.filter((x) => x.code === code)
  expect(d).toHaveLength(1)
  return d[0] as Diagnostic
}

beforeEach(() => {
  seen = []
  for (const m of ['error', 'warn', 'info', 'log', 'groupCollapsed', 'group', 'groupEnd'] as const)
    vi.spyOn(console, m).mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

type P = { id: string; age: number }
const people = (n: number): P[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, age: (i * 7) % 50 }))

/** A filter-stage feature whose rowModel is `fn`; `toggle()` changes its slice (re-runs it). */
const step = (fn: (indices: Uint32Array) => unknown, spy?: () => void): AnyFeature =>
  defineFeature({
    name: 'step',
    stage: 'filter',
    initialState: () => ({ n: 0 }),
    createApi: (ctx) => ({ bump: () => ctx.setState((s) => ({ n: s.n + 1 })) }),
    rowModel: (indices) => {
      spy?.()
      return fn(indices) as Uint32Array
    },
  }) as AnyFeature

const bump = (t: object) => (t as { bump(): void }).bump()

describe('DK_FEATURE_BAD_OUTPUT', () => {
  it.each([
    ['a plain array', (i: Uint32Array) => Array.from(i).slice(0, 1), 'an Array'],
    ['undefined', () => undefined, 'undefined'],
    ['a Promise', (i: Uint32Array) => Promise.resolve(i), 'a Promise'],
    ['a Float64Array', (i: Uint32Array) => Float64Array.from(i), 'a Float64Array'],
  ])('rowModel returning %s: error, input passed through, status error', (_, fn, received) => {
    const t = createTable({ data: people(4), onDiagnostic, features: [step(fn)] })
    const m = t.getRowModel()
    expect(m.rows).toHaveLength(4)
    expect(m.status).toBe('error')
    const d = only('DK_FEATURE_BAD_OUTPUT')
    expect(d.level).toBe('error')
    expect(d.where).toEqual({ kind: 'feature', name: 'step' })
    expect(d.details).toMatchObject({ feature: 'step', received })
    expect(d.problem).toContain(received)
    expect(d.impact).toMatch(/passed its input through/)
    expect(d.fix[0]).toMatch(/Uint32Array/)
  })

  it('an index out of range (>= data.length) is a bad output', () => {
    const t = createTable({
      data: people(3),
      onDiagnostic,
      features: [step(() => Uint32Array.of(0, 7))],
    })
    expect(t.getRowModel().rows).toHaveLength(3)
    const d = only('DK_FEATURE_BAD_OUTPUT')
    expect(d.details).toMatchObject({ index: 7, rowCount: 3 })
    expect(d.problem).toMatch(/7/)
  })

  it('a bad output is not memoised: the step runs again on the next run', () => {
    const spy = vi.fn()
    const t = createTable({
      data: people(3),
      onDiagnostic,
      features: [step(() => [0], spy)],
    })
    t.getRowModel()
    bump(t)
    t.getRowModel()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('a valid output (subarray, new array, input itself) reports nothing', () => {
    for (const fn of [
      (i: Uint32Array) => i.subarray(0, 2),
      (i: Uint32Array) => i.slice().reverse(),
      (i: Uint32Array) => i,
      () => new Uint32Array(0),
    ]) {
      const t = createTable({ data: people(5), onDiagnostic, features: [step(fn)] })
      expect(t.getRowModel().status).toBe('idle')
    }
    expect(codes()).toEqual([])
  })
})

describe('DK_FEATURE_MUTATED_INPUT', () => {
  it('rowModel sorting its input in place: warn, its output is still used', () => {
    const t = createTable({
      data: people(6),
      onDiagnostic,
      features: [step((i) => i.sort((a, b) => b - a))],
    })
    const m = t.getRowModel()
    expect(m.rows.map((r: { index: number }) => r.index)).toEqual([5, 4, 3, 2, 1, 0])
    expect(m.status).toBe('idle')
    const d = only('DK_FEATURE_MUTATED_INPUT')
    expect(d.level).toBe('warn')
    expect(d.where).toEqual({ kind: 'feature', name: 'step' })
    expect(d.details).toMatchObject({ feature: 'step' })
    expect(d.fix.join('\n')).toMatch(/slice\(\)/)
  })

  it('a single written element on a large input is caught when it is sampled', () => {
    const t = createTable({
      data: people(10_000),
      onDiagnostic,
      features: [
        step((i) => {
          i[0] = 9_999
          return i
        }),
      ],
    })
    t.getRowModel()
    expect(codes()).toContain('DK_FEATURE_MUTATED_INPUT')
  })

  it('reading the input (subarray, slice, sort of a copy) is not a mutation', () => {
    const t = createTable({
      data: people(200),
      onDiagnostic,
      features: [step((i) => i.slice().sort((a, b) => b - a))],
    })
    t.getRowModel()
    expect(codes()).toEqual([])
  })
})

describe('indexPrint', () => {
  it('is bounded: hashes at most 64 positions plus the length', () => {
    const a = new Uint32Array(100_000)
    const p = indexPrint(a)
    a[1] = 1 // not on the sampled stride
    expect(indexPrint(a)).toBe(p)
    a[0] = 1 // position 0 is always sampled
    expect(indexPrint(a)).not.toBe(p)
    expect(indexPrint(new Uint32Array(3))).not.toBe(indexPrint(new Uint32Array(4)))
  })

  it('covers every position of a small input', () => {
    const a = Uint32Array.of(0, 1, 2, 3, 4)
    const p = indexPrint(a)
    a[3] = 9
    expect(indexPrint(a)).not.toBe(p)
  })
})
