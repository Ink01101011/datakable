// @vitest-environment node
import { type FetchResult, search, sorting } from '@datakable/core'
import { withSearchFn } from '@datakable/core/search-async'
import { withFetcher } from '@datakable/core/server'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataTable } from './data-table'

// <DataTable /> server HTML (§7.2 × §10): a table whose async work is deferred to the client
// renders the Loading state, not Empty — its first rows are on their way.

type User = { id: number; name: string }
const users: User[] = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Grace' },
]
const columns = [{ key: 'name', header: 'Name' }] as const

beforeEach(() => {
  for (const m of ['warn', 'error', 'info', 'log', 'groupCollapsed', 'groupEnd'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {})
  }
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('<DataTable /> on the server (§7.2, §10)', () => {
  it('a fetcher without initialData: pending + isInitialLoad renders Loading, not Empty', () => {
    const fetcher = vi.fn(() => Promise.resolve<FetchResult<User>>({ rows: users }))
    const html = renderToString(
      <DataTable<User>
        columns={columns}
        features={[sorting({ mode: 'server' })]}
        fetcher={withFetcher(fetcher)}
      />,
    )
    expect(fetcher).not.toHaveBeenCalled()
    expect(html).toContain('data-status="pending"')
    expect(html).toContain('data-initial-load="true"')
    expect(html).toContain('data-dk-state="loading"')
    expect(html).toContain('Loading…')
    expect(html).not.toContain('No rows')
  })

  it('a deferred searchFn with nothing applied yet renders Loading', () => {
    const searchFn = vi.fn(() => Promise.resolve([] as User[]))
    const html = renderToString(
      <DataTable<User>
        columns={columns}
        features={[search<User>({ searchFn: withSearchFn(searchFn) })]}
        initialState={{ search: { input: 'ada', query: 'ada', status: 'idle' } }}
      />,
    )
    expect(searchFn).not.toHaveBeenCalled()
    expect(html).toContain('data-status="pending"')
    expect(html).toContain('Loading…')
    expect(html).not.toContain('No rows')
  })

  it('with initialData: the rows render (nothing is loading)', () => {
    const fetcher = vi.fn(() => Promise.resolve<FetchResult<User>>({ rows: [] }))
    const html = renderToString(
      <DataTable<User>
        columns={columns}
        features={[sorting({ mode: 'server' })]}
        fetcher={withFetcher(fetcher)}
        initialData={users}
      />,
    )
    expect(html).toContain('Ada')
    expect(html).not.toContain('Loading…')
  })

  it('no async source and no data: Empty, even if pending (Loading is for async work only)', () => {
    const html = renderToString(<DataTable<User> columns={columns} />)
    expect(html).toContain('No rows')
    expect(html).not.toContain('Loading…')
  })

  const objRows: { id: number; obj: unknown }[] = [
    { id: 1, obj: { a: 1 } },
    { id: 2, obj: 'ok' },
  ]
  it("an object cell renders '' and reports DK_UNRENDERABLE_VALUE (#18; no effects run here)", () => {
    const codes: string[] = []
    const html = renderToString(
      <DataTable
        data={objRows}
        columns={[{ key: 'id' }, { key: 'obj' }]}
        onDiagnostic={(d) => codes.push(d.code)}
      />,
    )
    expect(html).toContain('<td>ok</td>')
    expect(codes).toEqual(['DK_UNRENDERABLE_VALUE'])
  })
})
