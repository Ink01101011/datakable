import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatWhere } from '../diagnostics/build'
import type { Diagnostic } from '../diagnostics/types'
import { sorting } from '../features/sorting/sorting'
import { createTable } from '../table/create-table'
import { defineFeature } from './define'

beforeEach(() => {
  for (const m of ['warn', 'error', 'groupCollapsed', 'groupEnd', 'log'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {})
  }
})

const broken = (name: string) =>
  defineFeature({
    name,
    stage: 'none',
    initialState: () => 0,
    createApi: () => {
      throw new TypeError('setup bug')
    },
  })

type Loose = Record<string, (...a: unknown[]) => unknown>

/**
 * R4 carry-over: a feature whose `createApi()` threw has no methods on the table, but its types
 * still promise them. In development, calling one is a no-op that reports which feature failed
 * (`DK_FEATURE_FAILED`, `method`), instead of a raw TypeError at the user's call site.
 */
describe('a method of a feature whose createApi() threw (dev)', () => {
  it('is a no-op reporting DK_FEATURE_FAILED with the method, not a TypeError', () => {
    const seen: Diagnostic[] = []
    const t = createTable({
      data: [{ n: 1 }],
      features: [broken('probe')],
      onDiagnostic: (d) => void seen.push(d),
    }) as unknown as Loose
    expect(seen.map((d) => d.code)).toEqual(['DK_FEATURE_FAILED'])
    let out: unknown = 'not called'
    expect(() => {
      out = t.probeToggle?.('x')
    }).not.toThrow()
    expect(out).toBeUndefined()
    const d = seen[1] as Diagnostic
    expect(d.code).toBe('DK_FEATURE_FAILED')
    expect(formatWhere(d.where)).toBe('feature "probe"')
    expect(d.details).toMatchObject({ feature: 'probe', hook: 'createApi', method: 'probeToggle' })
    expect(d.problem).toMatch(/probeToggle\(\)/)
    expect(d.problem).toMatch(/createApi\(\) threw/)
    expect(d.fix.length).toBeGreaterThan(0)
    expect(d.context.trigger).toBe('api:probeToggle')
  })

  it('keeps the table identity, its own methods and the working features', () => {
    const t = createTable({
      data: [{ n: 2 }, { n: 1 }],
      columns: [{ key: 'n' }],
      features: [broken('probe'), sorting()],
    })
    t.toggleSort('n')
    expect(t.getRowModel().rows.map((r) => r.original.n)).toEqual([1, 2])
    expect(t.getSortDirection('n')).toBe('asc')
    expect(Object.hasOwn(t, 'probeToggle')).toBe(false)
    expect('probeToggle' in t).toBe(false)
  })

  it('stays safe for generic code: await, JSON, String, symbols, React / test-runner probes', async () => {
    const t = createTable({ data: [], features: [broken('probe')] }) as unknown as Loose
    for (const k of [
      'then',
      'catch',
      'finally',
      'toJSON',
      '$$typeof',
      'asymmetricMatch',
      'nodeType',
      '_owner',
      '@@iterator',
    ]) {
      expect((t as Record<string, unknown>)[k], k).toBeUndefined()
    }
    await expect(Promise.resolve(t)).resolves.toBe(t)
    expect(() => JSON.stringify(Object.keys(t))).not.toThrow()
    expect(String(t)).toBe('[object Object]')
    expect((t as Record<symbol, unknown>)[Symbol.iterator]).toBeUndefined()
  })

  it('names every failed feature when more than one createApi() threw', () => {
    const seen: Diagnostic[] = []
    const t = createTable({
      data: [],
      features: [broken('a'), broken('b')],
      onDiagnostic: (d) => void seen.push(d),
    }) as unknown as Loose
    t.aMethod?.()
    expect(seen.at(-1)?.details).toMatchObject({ feature: 'a, b', method: 'aMethod' })
  })

  it('after destroy(): DK_TABLE_DESTROYED like any API call', () => {
    const seen: Diagnostic[] = []
    const t = createTable({
      data: [],
      features: [broken('probe')],
      onDiagnostic: (d) => void seen.push(d),
    }) as unknown as Loose & { destroy(): void }
    t.destroy()
    expect(() => t.probeToggle?.()).not.toThrow()
    expect(seen.at(-1)?.code).toBe('DK_TABLE_DESTROYED')
  })

  it('a table whose features all installed is a plain object (no proxy)', () => {
    const t = createTable({ data: [], features: [sorting()] })
    expect(Object.getPrototypeOf(t)).toBe(Object.prototype)
    expect((t as unknown as Record<string, unknown>).probeToggle).toBeUndefined()
  })
})
