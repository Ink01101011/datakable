import { afterEach, describe, expect, it, vi } from 'vitest'
import { optionMessages } from '../catalog/codes'
import { DatakableConfigError } from '../diagnostics/build'
import { installMessages } from '../diagnostics/catalog'
import { proseMessages } from '../diagnostics/prose'
import type { Diagnostic } from '../diagnostics/types'
import { defineFeature } from '../feature/define'
import { pagination } from '../features/pagination'
import { search } from '../features/search'
import { sorting } from '../features/sorting'
import { makeSchema } from '../ingest/test-schemas'
import { withFetcher } from '../source/with-fetcher'
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
    // Without the messages, the wrapper to use is a prose key (structured, no sentence).
    expect(d.details).toMatchObject({ expected: 'wrapped|withSearchFn|searchFn|search-async' })
  })

  it('with datakable/messages: the text names the entry point and the received type (#41)', () => {
    // As datakable/messages does: the codes' text and the detail sentences (prose keys).
    installMessages(optionMessages, proseMessages)
    const thrown = (create: () => unknown) => {
      try {
        create()
      } catch (e) {
        return (e as DatakableConfigError).diagnostic
      }
      throw new Error('did not throw')
    }
    const fetcher = thrown(() =>
      createTable({
        features: [pagination({ mode: 'server' })],
        fetcher: (async () => ({})) as never,
      }),
    )
    expect(fetcher.problem).toBe(
      "options.fetcher must be withFetcher(fetcher) from '@datakable/core/server', got function",
    )
    expect(fetcher.fix).toEqual([
      "pass withFetcher(fetcher) from '@datakable/core/server' as options.fetcher, or leave " +
        'it out for the default',
    ])
    const schema = thrown(() =>
      createTable({ data: [{ id: 1 }], schema: makeSchema((v) => ({ value: v })) as never }),
    )
    expect(schema.problem).toBe(
      "options.schema must be withSchema(schema) from '@datakable/core/schema', got object",
    )
    const searchFn = thrown(() =>
      createTable({ data: [{ id: 1 }], features: [search({ searchFn: (() => []) as never })] }),
    )
    expect(searchFn.problem).toBe(
      "search({ searchFn }) must be withSearchFn(searchFn) from '@datakable/core/search-async', got " +
        'function',
    )
  })
})

describe('production: invalid timeout / data fall back cheaply (#94)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([-1, Number.NaN, 0])('timeout %s falls back to the 30 s default', async (timeout) => {
    vi.useFakeTimers()
    const seen: Diagnostic[] = []
    const t = createTable({
      fetcher: withFetcher(() => new Promise(() => {})),
      timeout,
      features: [pagination({ mode: 'server' })],
      onDiagnostic: (d) => seen.push(d),
    })
    expect(t.getRowModel().status).toBe('fetching')
    await vi.advanceTimersByTimeAsync(29_000)
    expect(t.getRowModel().status).toBe('fetching')
    await vi.advanceTimersByTimeAsync(1_100)
    expect(seen.map((d) => d.code)).toContain('DK_ASYNC_TIMEOUT')
    expect(t.getRowModel().status).toBe('error')
  })

  it('timeout Infinity still disables the timer', async () => {
    vi.useFakeTimers()
    const seen: Diagnostic[] = []
    const t = createTable({
      fetcher: withFetcher(() => new Promise(() => {})),
      timeout: Number.POSITIVE_INFINITY,
      features: [pagination({ mode: 'server' })],
      onDiagnostic: (d) => seen.push(d),
    })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(seen.map((d) => d.code)).not.toContain('DK_ASYNC_TIMEOUT')
    expect(t.getRowModel().status).toBe('fetching')
  })

  it('data: null counts as not given: isInitialLoad stays true until data arrives', () => {
    const listener = vi.fn()
    // biome-ignore lint/suspicious/noExplicitAny: an invalid value on purpose
    const t = createTable({ data: null as any })
    t.subscribe(listener)
    expect(t.getRowModel()).toMatchObject({ isInitialLoad: true, status: 'idle' })
    expect(t.getRowModel().rows).toHaveLength(0)
    t.setOptions({ data: [{ id: 1 }] })
    expect(t.getRowModel()).toMatchObject({ isInitialLoad: false })
    expect(t.getRowModel().rows).toHaveLength(1)
  })

  it('server mode: restored sort / page state is validated before the fetcher (#100)', () => {
    const params: unknown[] = []
    const seen: Diagnostic[] = []
    const make = (initialState: object) =>
      createTable({
        columns: [{ key: 'n' }] as never,
        fetcher: withFetcher((p) => {
          params.push({ sort: p.sort, pageIndex: p.pageIndex, pageSize: p.pageSize })
          return new Promise(() => {})
        }),
        features: [sorting({ mode: 'server' }), pagination({ mode: 'server' })],
        initialState,
        onDiagnostic: (d) => seen.push(d),
      })
    make({
      sorting: {
        by: [
          { id: 'n&x=1', desc: false },
          { id: 'n', desc: 1 },
        ],
      },
      pagination: { pageIndex: 1e308, pageSize: 10 },
    })
    // A malformed slice (no dev guard in production) sends no sort at all.
    make({ sorting: { by: 'n' } })
    expect(params).toEqual([
      { sort: [{ id: 'n', desc: false }], pageIndex: 0, pageSize: 10 },
      { sort: [], pageIndex: 0, pageSize: 10 },
    ])
    // Dropped silently: the diagnostic is development only (production stays small).
    expect(seen.map((d) => d.code)).not.toContain('DK_STATE_UNKNOWN_KEY')
  })
})
