import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDiagnosticDefinition } from '../diagnostics/catalog'
import { STEP_BUDGET_MS, tracer } from '../diagnostics/tracer'
import type { Diagnostic } from '../diagnostics/types'
import { defineFeature } from '../feature/define'
import type { AnyFeature } from '../feature/types'
import { sorting } from '../features/sorting/sorting'
import { createTable } from '../table/create-table'

// DK_ENV_FALLBACK (missing Intl.Collator locale; scheduler.yield is covered in slice.test.ts) and
// DK_PERF_HINT (a traced step over the 50 ms budget), §8.3.

let seen: Diagnostic[]
const onDiagnostic = (d: Diagnostic) => {
  seen.push(d)
}
const of = (code: string) => seen.filter((d) => d.code === code)

beforeEach(() => {
  seen = []
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

const rows = [{ s: 'b' }, { s: 'a' }, { s: 'c' }]
const toggle = (t: object, id: string) =>
  (t as unknown as { toggleSort(id: string): void }).toggleSort(id)

describe('DK_ENV_FALLBACK: Intl.Collator locale (§6.4, §8.3)', () => {
  it('a locale the runtime does not support: info naming the requested locale and the fallback', () => {
    // 'xx' is a well-formed BCP 47 tag (the option check accepts it) that no ICU build has.
    const t = createTable({
      data: rows,
      columns: [{ key: 's' }],
      features: [sorting({ locale: 'xx' })],
      onDiagnostic,
    })
    toggle(t, 's')
    expect(t.getRowModel().rows.map((r) => r.original.s)).toEqual(['a', 'b', 'c'])
    const [d] = of('DK_ENV_FALLBACK')
    expect(d?.level).toBe('info')
    expect(d?.where).toEqual({ kind: 'feature', name: 'sorting' })
    expect(d?.details).toMatchObject({ api: 'Intl.Collator', feature: 'sorting', requested: 'xx' })
    expect(String(d?.details.fallback)).toMatch(/runtime's collation/)
    expect(d?.problem).toContain('Intl.Collator')
    expect(d?.fix.length).toBeGreaterThan(0)
    // Once per feature instance: the collator is created once.
    toggle(t, 's')
    expect(of('DK_ENV_FALLBACK')).toHaveLength(1)
  })

  it('a supported locale (or none) reports nothing', () => {
    for (const locale of [undefined, 'th', ['xx', 'en']] as const) {
      seen = []
      const t = createTable({
        data: rows,
        columns: [{ key: 's' }],
        features: [sorting(locale === undefined ? {} : { locale })],
        onDiagnostic,
      })
      toggle(t, 's')
      t.getRowModel()
      expect(of('DK_ENV_FALLBACK')).toEqual([])
    }
  })
})

describe('DK_PERF_HINT: a traced step over the budget (§8.3, §9.3)', () => {
  /** A filter whose rowModel takes `ms` on the (mocked) clock. */
  function slow(ms: number) {
    let clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    return defineFeature({
      name: 'slowFilter',
      stage: 'filter',
      initialState: () => ({}),
      createApi: () => ({}),
      rowModel: (indices) => {
        clock += ms
        return indices
      },
    }) as AnyFeature
  }

  it('reports the feature, stage, time, rows and budget (dev tracer)', () => {
    const t = createTable({ data: rows, features: [slow(80)], onDiagnostic })
    t.getRowModel()
    const [d] = of('DK_PERF_HINT')
    expect(d?.level).toBe('info')
    expect(d?.where).toEqual({ kind: 'feature', name: 'slowFilter' })
    expect(d?.details).toMatchObject({
      feature: 'slowFilter',
      stage: 'filter',
      ms: 80,
      rows: 3,
      budget: STEP_BUDGET_MS,
    })
    expect(d?.problem).toContain('80.0 ms')
    expect(d?.fix[0]).toContain("slowFilter({ mode: 'server' })")
  })

  it('a step within the budget reports nothing', () => {
    const t = createTable({ data: rows, features: [slow(10)], onDiagnostic })
    t.getRowModel()
    expect(of('DK_PERF_HINT')).toEqual([])
  })

  it('comes from the tracer: a user tracer() reports it once, not twice', () => {
    const t = createTable({
      data: rows,
      features: [slow(80)],
      interceptors: [tracer()],
      onDiagnostic,
    })
    t.getRowModel()
    expect(of('DK_PERF_HINT')).toHaveLength(1)
  })

  it('both codes are info-level catalog entries', () => {
    for (const code of ['DK_ENV_FALLBACK', 'DK_PERF_HINT'] as const) {
      expect(getDiagnosticDefinition(code)?.level).toBe('info')
    }
  })
})
