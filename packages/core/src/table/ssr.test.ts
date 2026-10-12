import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from '../diagnostics/types'
import { pagination } from '../features/pagination'
import { search } from '../features/search'
import { sorting } from '../features/sorting'
import { makeSchema } from '../ingest/test-schemas'
import type { FetchParams, FetchResult } from '../source/fetcher'
import { createTable } from './create-table'
import { createDeferred, startTable } from './ssr'

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

type P = { id: string; n: number }
const people = (n: number, from = 0): P[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${from + i}`, n: from + i }))
const ns = (t: { getRowModel(): { rows: readonly { original: unknown }[] } }) =>
  t.getRowModel().rows.map((r) => (r.original as P).n)
const tick = () => new Promise((r) => setTimeout(r, 0))
const api = (t: object) => t as unknown as Record<string, (...a: unknown[]) => unknown>

function manual() {
  const calls: { params: FetchParams; resolve: (r: FetchResult<P>) => void }[] = []
  const fetcher = vi.fn(
    (params: FetchParams) =>
      new Promise<FetchResult<P>>((resolve) => {
        calls.push({ params, resolve })
      }),
  )
  return { fetcher, calls }
}

describe('initialData (§7.2)', () => {
  it('is ingested at creation like data: rows, isInitialLoad false, schema applied', () => {
    const rows = people(3)
    const t = createTable({ initialData: rows, features: [sorting()] })
    expect(ns(t)).toEqual([0, 1, 2])
    expect(t.getData()).toBe(rows)
    expect(t.getRowModel().isInitialLoad).toBe(false)
    expect(t.getRowModel().status).toBe('idle')

    const schema = makeSchema<P>((v) =>
      typeof (v as P).n === 'number'
        ? { value: v as P }
        : { issues: [{ message: 'n', path: ['n'] }] },
    )
    const s = createTable({ initialData: [{ id: 'a', n: 1 }, { id: 'b' }], schema })
    expect(s.getRowModel().rows).toHaveLength(1)
    expect(s.getInvalidRows()).toHaveLength(1)
  })

  it('with a fetcher, the first request is skipped; a server-state change fetches', async () => {
    const m = manual()
    const t = createTable({
      initialData: people(10),
      rowCount: 95,
      fetcher: m.fetcher,
      features: [sorting({ mode: 'server' }), pagination({ mode: 'server' })],
      initialState: { pagination: { pageIndex: 2, pageSize: 10 } },
    })
    await tick()
    expect(m.fetcher).not.toHaveBeenCalled()
    expect(t.getRowModel().status).toBe('idle')
    expect(t.getRowModel().isInitialLoad).toBe(false)
    // The server total for initialData: rowCount (no DK_OPTION_NO_EFFECT with initialData).
    expect(api(t).getPageCount?.()).toBe(10)
    expect(t.getDiagnostics().map((d) => d.code)).not.toContain('DK_OPTION_NO_EFFECT')
    api(t).toggleSort?.('n')
    expect(m.fetcher).toHaveBeenCalledTimes(1)
    expect(m.calls[0]?.params.sort).toEqual([{ id: 'n', desc: false }])
    expect(t.getRowModel().status).toBe('fetching')
    expect(t.getRowModel().isInitialLoad).toBe(false)
  })

  it('refetch() still runs the fetcher', async () => {
    const fetcher = vi.fn(() => ({ rows: people(2), rowCount: 2 }))
    const t = createTable({
      initialData: people(1),
      fetcher,
      features: [sorting({ mode: 'server' })],
    })
    expect(fetcher).not.toHaveBeenCalled()
    await expect(t.refetch()).resolves.toEqual({ status: 'applied' })
    expect(ns(t)).toEqual([0, 1])
  })

  it('with data as well, data wins and initialData has no effect (DK_OPTION_NO_EFFECT)', () => {
    const diags: Diagnostic[] = []
    const t = createTable({
      data: people(2),
      initialData: people(5),
      onDiagnostic: (d) => diags.push(d),
    })
    expect(t.getRowModel().rows).toHaveLength(2)
    const d = diags.find((x) => x.code === 'DK_OPTION_NO_EFFECT')
    expect(d?.where).toEqual({ kind: 'option', path: 'initialData' })
  })

  it('is the result of a searchFn for the initial query: no call, rows as given', async () => {
    const searchFn = vi.fn(() => [] as P[])
    const t = createTable({
      initialData: people(3),
      columns: [{ key: 'id' }],
      features: [search<P>({ searchFn })],
      initialState: { search: { input: 'p', query: 'p', status: 'idle' } },
    })
    expect(ns(t)).toEqual([0, 1, 2])
    await tick()
    await tick()
    expect(searchFn).not.toHaveBeenCalled()
    expect(t.getRowModel().status).toBe('idle')
    // A new query searches.
    await api(t).setSearch?.('p1')
    expect(searchFn).toHaveBeenCalledTimes(1)
  })
})

describe('createDeferred / startTable (§7.2)', () => {
  it('a deferred fetcher starts no request and no timer until startTable; status pending', async () => {
    vi.useFakeTimers()
    const m = manual()
    const diags: Diagnostic[] = []
    const t = createDeferred(() =>
      createTable({
        fetcher: m.fetcher,
        features: [sorting({ mode: 'server' })],
        onDiagnostic: (d) => diags.push(d),
      }),
    )
    expect(m.fetcher).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(t.getRowModel().status).toBe('pending')
    expect(t.getRowModel().isInitialLoad).toBe(true)
    // Server-state changes while deferred do not fetch either.
    api(t).toggleSort?.('n')
    expect(m.fetcher).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    // No document here: the server render reports the deferral (info).
    const d = diags.filter((x) => x.code === 'DK_SSR_ASYNC_DEFERRED')
    expect(d).toHaveLength(1)
    expect(d[0]?.level).toBe('info')
    expect(d[0]?.where).toEqual({ kind: 'option', path: 'fetcher' })
    expect(d[0]?.context.phase).toBe('ssr')

    const seen: string[] = []
    t.subscribe(() => seen.push(t.getRowModel().status))
    startTable(t)
    expect(m.fetcher).toHaveBeenCalledTimes(1)
    expect(m.calls[0]?.params.sort).toEqual([{ id: 'n', desc: false }])
    expect(seen).toEqual(['fetching'])
    startTable(t)
    expect(m.fetcher).toHaveBeenCalledTimes(1)
    m.calls[0]?.resolve({ rows: people(2), rowCount: 2 })
    await vi.runAllTimersAsync()
    expect(t.getRowModel().status).toBe('idle')
    expect(ns(t)).toEqual([0, 1])
  })

  it('deferred with initialData: nothing is deferred, starting does not fetch', async () => {
    const m = manual()
    const diags: string[] = []
    const t = createDeferred(() =>
      createTable({
        initialData: people(2),
        fetcher: m.fetcher,
        features: [sorting({ mode: 'server' })],
        onDiagnostic: (d) => diags.push(d.code),
      }),
    )
    expect(t.getRowModel().status).toBe('idle')
    startTable(t)
    await tick()
    expect(m.fetcher).not.toHaveBeenCalled()
    expect(diags).not.toContain('DK_SSR_ASYNC_DEFERRED')
  })

  it('a deferred searchFn for an initial query: pending, unsearched rows, searches once started', async () => {
    const searchFn = vi.fn(({ rows }: { rows: readonly P[] }) => Promise.resolve([rows[1] as P]))
    const diags: Diagnostic[] = []
    const t = createDeferred(() =>
      createTable({
        data: people(3),
        columns: [{ key: 'id' }],
        features: [search<P>({ searchFn })],
        initialState: { search: { input: 'p1', query: 'p1', status: 'idle' } },
        onDiagnostic: (d) => diags.push(d),
      }),
    )
    const first = t.getRowModel()
    expect(first.status).toBe('pending')
    expect(ns(t)).toEqual([0, 1, 2])
    // A stable snapshot while nothing changes (useSyncExternalStore).
    expect(t.getRowModel()).toBe(first)
    await tick()
    await tick()
    expect(searchFn).not.toHaveBeenCalled()
    expect(t.getRowModel()).toBe(first)
    const d = diags.filter((x) => x.code === 'DK_SSR_ASYNC_DEFERRED')
    expect(d.map((x) => x.where)).toEqual([{ kind: 'feature', name: 'search' }])

    startTable(t)
    await tick()
    await tick()
    expect(searchFn).toHaveBeenCalledTimes(1)
    expect(ns(t)).toEqual([1])
    expect(t.getRowModel().status).toBe('idle')
  })

  it('a blank initial query or a client table defers nothing', () => {
    const diags: string[] = []
    const t = createDeferred(() =>
      createTable({
        data: people(3),
        features: [search<P>({ searchFn: () => [] }), sorting()],
        onDiagnostic: (d) => diags.push(d.code),
      }),
    )
    expect(t.getRowModel().status).toBe('idle')
    expect(diags).not.toContain('DK_SSR_ASYNC_DEFERRED')
  })

  it('a table created outside createDeferred is not deferred; destroy before start is safe', () => {
    const m = manual()
    createTable({ fetcher: m.fetcher, features: [sorting({ mode: 'server' })] })
    expect(m.fetcher).toHaveBeenCalledTimes(1)
    const t = createDeferred(() =>
      createTable({ fetcher: m.fetcher, features: [sorting({ mode: 'server' })] }),
    )
    t.destroy()
    startTable(t)
    expect(m.fetcher).toHaveBeenCalledTimes(1)
  })
})
