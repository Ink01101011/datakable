import { afterEach, describe, expect, it } from 'vitest'
import { createTable } from '../table/create-table'
import { defineFeature } from './define'
import { featureRuntime } from './runtime'

/**
 * §3.3, changed 2026-10-13 for §9.3: the feature runtime (stage order, API install, column cache,
 * time-slicing, explainRow details) comes with `defineFeature`, so a table without features does
 * not bundle it.
 */
const saved = featureRuntime.current
afterEach(() => {
  featureRuntime.current = saved
})

const raw = {
  name: 'raw',
  stage: 'filter' as const,
  initialState: () => 0,
  createApi: () => ({}),
  rowModel: (i: Uint32Array) => i,
}

describe('feature runtime', () => {
  it('loading defineFeature installs it', () => {
    expect(defineFeature).toBeTypeOf('function')
    expect(featureRuntime.current).toBeDefined()
  })

  it('a table without features needs none: rows, state, explain and explainRow work', () => {
    featureRuntime.current = undefined
    const t = createTable({ data: [{ id: 1 }, { id: 2 }], rowKey: 'id', initialState: { x: 1 } })
    expect(t.getRowModel().rows.map((r) => r.key)).toEqual([1, 2])
    expect(t.getState()).toEqual({ x: 1 })
    expect(t.explain().rows).toBe(2)
    expect(t.explainRow(2)).toMatchObject({ found: true, visible: true, steps: [] })
  })

  it('features without a loaded runtime throw, naming defineFeature', () => {
    featureRuntime.current = undefined
    expect(() => createTable({ data: [], features: [raw] })).toThrow(/defineFeature\(\)/)
  })

  it('a plain-object feature works once the runtime is loaded', () => {
    const t = createTable({ data: [{ a: 1 }], features: [raw] })
    expect(t.getRowModel().rows).toHaveLength(1)
    expect(t.getState()).toEqual({ raw: 0 })
  })
})
