import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatakableConfigError } from '../diagnostics/build'
import type { Diagnostic } from '../diagnostics/types'
import { defineFeature } from '../feature/define'
import { pagination } from '../features/pagination'
import { search } from '../features/search'
import { makeSchema } from '../ingest/test-schemas'
import { createTable } from './create-table'

/**
 * §3.4 `optionValidator`, changed 2026-10-13 for §9.3: the option validator (catalog, table-options
 * schema, did-you-mean) runs in development only. A production build keeps only what correctness
 * needs: `setOptions` still keeps the previous value of every read-once option.
 */
vi.mock('../diagnostics/env', () => ({ DEV: false }))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('production: option validation is off', () => {
  it('unknown and invalid options are neither reported nor thrown', () => {
    const seen: Diagnostic[] = []
    const t = createTable({
      data: [{ id: 1 }],
      onDiagnostic: (d) => seen.push(d),
      // biome-ignore lint/suspicious/noExplicitAny: an unknown option on purpose
      ...({ dataa: [] } as any),
      timeout: -1,
    })
    expect(t.getRowModel().rows).toHaveLength(1)
    expect(seen.map((d) => d.code)).toEqual([])
  })

  it('read-once options keep their first value on setOptions', () => {
    const t = createTable({ name: 'first', data: [{ id: 1 }], timeout: 1000, strict: false })
    t.setOptions({ name: 'second', timeout: 5, strict: true, columns: [{ key: 'id' }] })
    expect(t.getOptions()).toMatchObject({ name: 'first', timeout: 1000, strict: false })
    expect(t.getOptions().columns).toEqual([{ key: 'id' }])
  })

  it('a read-once option absent at creation stays absent', () => {
    const t = createTable({ data: [{ id: 1 }] })
    t.setOptions({ name: 'late' })
    expect('name' in t.getOptions()).toBe(false)
  })
})

describe('production: development checks are off (changed 2026-10-13 for §9.3)', () => {
  it('version checks (§8.5): an unmet requires.core does not throw', () => {
    const f = defineFeature({
      name: 'future',
      stage: 'none',
      requires: { core: '^99.0.0' },
      initialState: () => 0,
      createApi: () => ({}),
    })
    expect(() => createTable({ data: [], features: [f] })).not.toThrow()
  })

  it('data checks (§5.3): an unknown column path is not reported', () => {
    const seen: Diagnostic[] = []
    createTable({
      data: [{ id: 1, name: 'a' }],
      columns: [{ key: 'nmae' as never }],
      onDiagnostic: (d) => seen.push(d),
    }).getRowModel()
    expect(seen.map((d) => d.code)).toEqual([])
  })
})

describe('production: an unwrapped schema / fetcher / searchFn is never ignored silently (§8.6)', () => {
  it('a schema not wrapped with withSchema() throws DK_INVALID_OPTION at creation', () => {
    const create = () =>
      createTable({ data: [{ id: 1 }], schema: makeSchema((v) => ({ value: v })) as never })
    expect(create).toThrow(DatakableConfigError)
    expect(create).toThrow(/DK_INVALID_OPTION/)
  })

  it('a fetcher not wrapped with withFetcher() throws DK_INVALID_OPTION, at creation and on setOptions', () => {
    const fetcher = async () => ({ rows: [], rowCount: 0 })
    const features = [pagination({ mode: 'server' })]
    expect(() => createTable({ features, fetcher: fetcher as never })).toThrow(/DK_INVALID_OPTION/)
    const t = createTable({ data: [{ id: 1 }], features })
    expect(() => t.setOptions({ fetcher: fetcher as never })).toThrow(/DK_INVALID_OPTION/)
  })

  it('a searchFn not wrapped with withSearchFn() throws DK_INVALID_OPTION naming search', () => {
    let error: unknown
    try {
      createTable({ data: [{ id: 1 }], features: [search({ searchFn: (() => []) as never })] })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(DatakableConfigError)
    const d = (error as DatakableConfigError).diagnostic
    expect(d.code).toBe('DK_INVALID_OPTION')
    expect(d.details).toMatchObject({ feature: 'search', path: 'searchFn', phase: 'init' })
  })
})
