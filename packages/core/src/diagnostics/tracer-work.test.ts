import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineFeature } from '../feature/define'
import type { AnyFeature } from '../feature/types'
import { createTable } from '../table/create-table'
import type { ExplainStep } from './explain'
import type { Diagnostic } from './types'

// The tracer and work it does not see as one step: time-sliced jobs (#61) and the column batches
// inside a step (#62). A manual clock: the work below advances it, nothing else does.

let clock = 0
let seen: Diagnostic[]
const onDiagnostic = (d: Diagnostic) => {
  seen.push(d)
}
const hints = () => seen.filter((d) => d.code === 'DK_PERF_HINT')

beforeEach(() => {
  clock = 0
  seen = []
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  for (const m of ['warn', 'error', 'info', 'groupCollapsed', 'groupEnd', 'log'] as const)
    vi.spyOn(console, m).mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Lets every pending slice run (setTimeout fallback: one macrotask per slice). */
async function settle(rounds = 50) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0))
}

/** A filter whose kept set comes from a sliced job: one slice per entry of `slices` (its ms). */
function slicedFilter(slices: number[]) {
  const key = {}
  return defineFeature({
    name: 'evens',
    stage: 'filter',
    initialState: () => ({ on: false }),
    createApi: (ctx) => ({ turnOn: () => ctx.setState({ on: true }) }),
    rowModel: (indices, state, ctx) => {
      if (!state.on) return indices
      const keep = ctx.slice?.(key, function* () {
        for (const ms of slices) {
          clock += ms
          yield
        }
        return indices.filter((r) => r % 2 === 0)
      })
      return keep ?? indices
    },
  }) as AnyFeature
}
const turnOn = (t: object) => (t as unknown as { turnOn(): void }).turnOn()
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, name: `n${i}` }))

describe('tracer: time-sliced work (#61)', () => {
  beforeEach(() => {
    // Slicing needs a browser phase.
    vi.stubGlobal('document', {})
  })

  it('explain() after the job shows the step with the time of every slice and run', async () => {
    const t = createTable({ data: rows(6), features: [slicedFilter([30, 30, 30, 30, 30])] })
    t.getRowModel()
    turnOn(t)
    expect(t.getRowModel().status).toBe('pending')
    await settle()
    expect(t.getRowModel().status).toBe('idle')
    const step = t.explain().steps.find((s: ExplainStep) => s.feature === 'evens')
    expect(step?.ms).toBe(150)
    expect(step?.runs).toBe(2)
    expect(String(t.explain())).toContain('evens 3 150.0 ms (sliced, 2 runs)')
  })

  it('a slice over the 50 ms budget reports DK_PERF_HINT, though the step itself was short', async () => {
    const t = createTable({ data: rows(6), features: [slicedFilter([10, 80])], onDiagnostic })
    t.getRowModel()
    turnOn(t)
    t.getRowModel()
    expect(hints()).toHaveLength(0)
    await settle()
    expect(hints()).toHaveLength(1)
    expect(hints()[0]?.details).toMatchObject({ feature: 'evens', ms: 80, sliced: true })
    expect(hints()[0]?.problem).toContain('a time slice of the "evens" step took 80.0 ms')
  })
})
