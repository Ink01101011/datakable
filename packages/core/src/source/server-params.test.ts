import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from '../diagnostics/types'
import { pagination } from '../features/pagination'
import { sorting } from '../features/sorting'
import { createTable } from '../table/create-table'
import type { FetchParams, FetchResult } from './fetcher'
import { withFetcher } from './with-fetcher'

/** #100: restored state reaches the fetcher only after validation (A2-3). */

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

type P = { id: string; name: string; n: number; secret: string }
const tick = () => new Promise((r) => setTimeout(r, 0))

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

const columns = [{ key: 'id' }, { key: 'name' }, { key: 'n' }, { key: 'secret', sortable: false }]

describe('server-mode sort ids from restored state (#100)', () => {
  it('drops entries that name no sortable column, with DK_STATE_UNKNOWN_KEY', () => {
    const m = manual()
    const diags: Diagnostic[] = []
    createTable({
      columns: columns as never,
      fetcher: withFetcher(m.fetcher),
      features: [sorting({ mode: 'server' })],
      initialState: {
        sorting: {
          by: [
            { id: 'name&role=admin', desc: false },
            { id: 'n', desc: true },
            { id: 'secret', desc: false },
          ],
        },
      } as never,
      onDiagnostic: (d) => diags.push(d),
    })
    expect(m.fetcher).toHaveBeenCalledTimes(1)
    expect(m.calls[0]?.params.sort).toEqual([{ id: 'n', desc: true }])
    const d = diags.filter((x) => x.code === 'DK_STATE_UNKNOWN_KEY')
    expect(d.map((x) => x.details.key)).toEqual(['name&role=admin', 'secret'])
    expect(d[0]?.details.slice).toBe('sorting')
    expect(d[0]?.details.known).toEqual(['id', 'name', 'n'])
    expect(d[0]?.where).toEqual({ kind: 'option', path: 'state.sorting.name&role=admin' })
  })

  it('a dropped entry does not refetch on every notification', async () => {
    const m = manual()
    const t = createTable({
      columns: columns as never,
      fetcher: withFetcher(m.fetcher),
      features: [sorting({ mode: 'server' }), pagination({ mode: 'server' })],
      initialState: { sorting: { by: [{ id: 'nope', desc: false }] } } as never,
      onDiagnostic: () => {},
    })
    expect(m.calls[0]?.params.sort).toEqual([])
    m.calls[0]?.resolve({ rows: [], rowCount: 0 })
    await tick()
    t.setOptions({ onDiagnostic: () => {} })
    t.getRowModel()
    expect(m.fetcher).toHaveBeenCalledTimes(1)
    // A real change still fetches, with the valid entries only.
    t.toggleSort('name', { multi: true })
    expect(m.fetcher).toHaveBeenCalledTimes(2)
    expect(m.calls[1]?.params.sort).toEqual([{ id: 'name', desc: false }])
  })

  it('without columns: ids are kept, but every entry is { id: string, desc: boolean }', () => {
    const m = manual()
    createTable({
      fetcher: withFetcher(m.fetcher),
      features: [sorting({ mode: 'server' })],
      initialState: {
        sorting: {
          by: [{ id: 'name', desc: 'x&y' }, { id: 7, desc: true }, null, { id: 'n', desc: true }],
        } as never,
      },
      onDiagnostic: () => {},
    })
    expect(m.calls[0]?.params.sort).toEqual([
      { id: 'name', desc: false },
      { id: 'n', desc: true },
    ])
  })
})

describe('server-mode pagination from restored state (#100)', () => {
  it('a pageIndex / pageSize beyond safe integers never reaches the fetcher', () => {
    const m = manual()
    const diags: Diagnostic[] = []
    createTable({
      fetcher: withFetcher(m.fetcher),
      features: [pagination({ mode: 'server' })],
      initialState: { pagination: { pageIndex: 1e308, pageSize: 1e300 } },
      onDiagnostic: (d) => diags.push(d),
    })
    expect(m.fetcher).toHaveBeenCalledTimes(1)
    expect(m.calls[0]?.params.pageIndex).toBe(0)
    expect(m.calls[0]?.params.pageSize).toBe(10)
    const d = diags.filter((x) => x.code === 'DK_INVALID_PAGINATION')
    expect(d.map((x) => x.details.field)).toEqual(['pageIndex', 'pageSize'])
  })
})

describe('server-mode sort entries with a deep restored field (#103 via #100)', () => {
  it('createTable does not overflow the stack, and the fetcher gets { id, desc } only', () => {
    let v: unknown = {}
    for (let i = 0; i < 10_000; i++) v = { a: v }
    const m = manual()
    const t = createTable({
      columns: columns as never,
      fetcher: withFetcher(m.fetcher),
      features: [sorting({ mode: 'server' }), pagination({ mode: 'server' })],
      initialState: { sorting: { by: [{ id: 'name', desc: true, extra: v }] } } as never,
    })
    expect(m.calls[0]?.params.sort).toEqual([{ id: 'name', desc: true }])
    t.destroy()
  })
})
