import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProductSearch } from './async-search/1-search-api'
import { OrdersTable } from './custom-columns/1-orders-table'
import { reportDiagnostics } from './error-reporting/1-report-diagnostics'
import { customersTable } from './error-reporting/2-customers-table'
import { UsersTable as HeadlessUsers } from './headless-table/1-users-table'
import { TradesTable } from './large-data/1-trades-table'
import { reportSlowRuns, timeRequests, trackActions } from './logging-interceptor/1-analytics'
import { UsersTable as HydratedUsers } from './nextjs-ssr/1-users-table'
import { rowSelection } from './row-selection-feature/1-row-selection'
import { UsersTable as SelectableUsers } from './row-selection-feature/2-users-table'
import { AccountSchema } from './schema-validation/1-account-schema'
import { AccountsTable } from './schema-validation/2-accounts-table'
import { UsersTable as ServerUsers } from './server-side-table/1-users-table'
import { UsersTable as ThemedUsers } from './theming/1-themed-table'
import { readUrl, UsersTable as UrlUsers, writeUrl } from './url-state/1-url-synced-table'
import { UsersTable as ZeroConfigUsers } from './zero-config/1-data-table'

/**
 * The cookbook recipes (`docs/examples/*.md`, D2) run: each recipe is imported and rendered (or
 * run), and what its page says you will see is asserted here. `pnpm typecheck` compiles the same
 * files against the built packages; this test maps `datakable` to the source so it needs no build.
 * The Next.js recipe's server render is `_nextjs-ssr.test.tsx` (node environment).
 */

vi.mock('datakable', () => import('../../index'))

const fs = (await import('node:fs' as string)) as {
  readFileSync(path: string, encoding: 'utf8'): string
}

let consoleSpies: { mockRestore(): void }[] = []
beforeEach(() => {
  // Diagnostics print in development; the recipes that trigger some assert them through sinks.
  consoleSpies = (['error', 'warn', 'info', 'log', 'groupCollapsed', 'groupEnd'] as const).map(
    (m) => vi.spyOn(console, m).mockImplementation(() => {}),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  for (const s of consoleSpies) s.mockRestore()
})

const bodyRows = (root: ParentNode = document) =>
  [...root.querySelectorAll('tbody tr:not([data-dk-state])')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => td.textContent),
  )

/** A JSON `Response` for a stubbed `fetch`. */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** The URL a stubbed `fetch` was called with (relative URLs resolved against a dummy origin). */
const urlOf = (input: unknown) => new URL(String(input), 'https://app.test')

describe('zero-config.md', () => {
  it('<DataTable data /> derives the columns and shows every row', () => {
    render(<ZeroConfigUsers />)
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers.join(' ')).toMatch(/id.*name.*email.*age.*city/i)
    expect(bodyRows()).toHaveLength(4)
    expect(screen.getByRole('searchbox')).toBeTruthy()
    expect(screen.getByText('Users')).toBeTruthy()
  })

  it('the headless table filters and sorts as the comments say', async () => {
    const log = vi.mocked(console.log)
    const { table } = await import('./zero-config/2-headless')
    expect(log).toHaveBeenCalledWith(['Mali Srisuk', 'Ploy Chai'])
    expect(log).toHaveBeenCalledWith('2 of 4')
    table.destroy()
  })
})

describe('custom-columns.md', () => {
  const orders = [
    {
      id: 'A-1001',
      customer: { name: 'Mali Srisuk', email: 'mali@example.com' },
      total: 1234.5,
      status: 'paid' as const,
      placedAt: new Date(Date.UTC(2026, 9, 1)),
      tags: ['gift', 'express'],
    },
    {
      id: 'A-1002',
      customer: { name: 'Anan Wong', email: 'anan@example.com' },
      total: 80,
      status: 'refunded' as const,
      placedAt: new Date(Date.UTC(2026, 9, 3)),
      tags: [],
    },
  ]

  it('renders headers, formatted values, the cell renderer and the derived column', () => {
    render(<OrdersTable orders={orders} />)
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent ?? '')
    expect(headers.map((h) => h.replace(/[▲▼↕]/g, '').trim())).toEqual([
      'Order',
      'Customer',
      'Email',
      'Total',
      'Status',
      'Placed',
      'Tags',
      'Summary',
    ])
    expect(bodyRows()[0]).toEqual([
      'A-1001',
      'Mali Srisuk',
      'mali@example.com',
      '$1,234.50',
      'paid',
      'Oct 1, 2026',
      'gift, express',
      '2 tags, paid',
    ])
    expect(document.querySelector('mark[data-order-status="refunded"]')?.textContent).toBe(
      'refunded',
    )
  })

  it('formatted columns sort by value; the derived column sorts; tags does not', () => {
    render(<OrdersTable orders={orders} />)
    fireEvent.click(screen.getByRole('button', { name: 'Total' }))
    expect(bodyRows().map((r) => r[3])).toEqual(['$80.00', '$1,234.50'])
    fireEvent.click(screen.getByRole('button', { name: 'Summary' }))
    expect(bodyRows().map((r) => r[7])).toEqual(['0 tags, refunded', '2 tags, paid'])
    expect(screen.queryByRole('button', { name: 'Tags' })).toBeNull()
  })

  it('search uses the weighted columns only', async () => {
    render(<OrdersTable orders={orders} />)
    await act(async () => {
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'anan' } })
    })
    expect(bodyRows().map((r) => r[0])).toEqual(['A-1002'])
  })
})

describe('headless-table.md', () => {
  const users = Array.from({ length: 25 }, (_, i) => ({
    id: i + 1,
    name: `User ${String(i + 1).padStart(2, '0')}`,
    age: 20 + ((i * 7) % 30),
    city: i % 3 === 0 ? 'Bangkok' : 'London',
  }))

  it('search, the city filter, sort headers and the pager drive the table', async () => {
    render(<HeadlessUsers users={users} cities={['Bangkok', 'London']} />)
    expect(screen.getByText(/Page 1 of 3 · 25 of\s+25 users/)).toBeTruthy()
    expect(bodyRows()).toHaveLength(10)

    fireEvent.change(screen.getByRole('combobox', { name: 'City' }), {
      target: { value: 'Bangkok' },
    })
    expect(screen.getByText(/9 of\s+25 users/)).toBeTruthy()
    expect(bodyRows().every((r) => r[2] === 'Bangkok')).toBe(true)

    const age = screen.getByRole('button', { name: 'Age' })
    fireEvent.click(age)
    expect(age.closest('th')?.getAttribute('aria-sort')).toBe('ascending')
    const ages = bodyRows().map((r) => Number(r[1]))
    expect(ages).toEqual([...ages].sort((a, b) => a - b))

    fireEvent.change(screen.getByRole('combobox', { name: 'City' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText(/Page 2 of 3/)).toBeTruthy()

    await act(async () => {
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bangkok' } })
    })
    // Every column is searched; the page goes back to 1.
    expect(screen.getByText(/Page 1 of 1 · 9 of\s+25 users/)).toBeTruthy()
  })
})

describe('server-side-table.md', () => {
  const all = Array.from({ length: 45 }, (_, i) => ({
    id: i + 1,
    name: `User ${String(45 - i).padStart(2, '0')}`,
    email: `user${i + 1}@example.com`,
  }))
  let fail = false
  const server = vi.fn(async (input: unknown) => {
    if (fail) return json({ message: 'down' }, 503)
    const url = urlOf(input)
    const q = url.searchParams.get('q') ?? ''
    const sort = url.searchParams.get('sort') ?? ''
    const page = Number(url.searchParams.get('page'))
    const size = Number(url.searchParams.get('size'))
    let rows = all.filter((u) => u.name.toLowerCase().includes(q.toLowerCase()))
    if (sort === 'name') rows = [...rows].sort((a, b) => a.name.localeCompare(b.name))
    if (sort === '-name') rows = [...rows].sort((a, b) => b.name.localeCompare(a.name))
    return json({ rows: rows.slice(page * size, page * size + size), rowCount: rows.length })
  })
  beforeEach(() => {
    fail = false
    server.mockClear()
    vi.stubGlobal('fetch', server)
  })

  it('Loading, then the first page; sorting refetches; a failed refresh keeps the rows', async () => {
    render(<ServerUsers />)
    expect(screen.getByRole('status').textContent).toBe('Loading users…')
    await screen.findByText('Page 1 of 3')
    expect(urlOf(server.mock.calls[0]?.[0]).pathname).toBe('/api/users')
    expect(bodyRows()).toHaveLength(20)

    fireEvent.click(screen.getByRole('button', { name: 'Name' }))
    await vi.waitFor(() => expect(bodyRows()[0]?.[0]).toBe('User 01'))
    expect(urlOf(server.mock.lastCall?.[0]).searchParams.get('sort')).toBe('name')

    fail = true
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Could not refresh; showing the previous results.')
    expect(bodyRows()[0]?.[0]).toBe('User 01') // the previous rows stay

    fail = false
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    await vi.waitFor(() => expect(bodyRows()[0]?.[0]).toBe('User 21'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a failed first load shows the error with Retry', async () => {
    fail = true
    render(<ServerUsers />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Could not load users.')
    fail = false
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    await screen.findByText('Page 1 of 3')
  })

  it('search goes to the server after the debounce', async () => {
    render(<ServerUsers />)
    await screen.findByText('Page 1 of 3')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'User 1' } })
    await screen.findByText('Page 1 of 1', {}, { timeout: 2000 })
    expect(urlOf(server.mock.lastCall?.[0]).searchParams.get('q')).toBe('User 1')
  })
})

describe('async-search.md', () => {
  const products = [
    { sku: 'D-1', name: 'Desk chair', price: 120 },
    { sku: 'D-2', name: 'Desk lamp', price: 40 },
    { sku: 'S-1', name: 'Standing desk', price: 450 },
    { sku: 'M-1', name: 'Monitor arm', price: 90 },
  ]
  const api = vi.fn(async (input: unknown) => {
    const q = (urlOf(input).searchParams.get('q') ?? '').toLowerCase()
    if (q === 'boom') return json({}, 500)
    // The "index" ranks a name that ends with the query first (not the data order).
    const ends = (name: string) => Number(name.toLowerCase().endsWith(q))
    const skus = products
      .filter((p) => p.name.toLowerCase().includes(q))
      .sort((a, b) => ends(b.name) - ends(a.name))
      .map((p) => p.sku)
    return json({ skus })
  })
  beforeEach(() => {
    api.mockClear()
    vi.stubGlobal('fetch', api)
  })

  it('debounces, calls the search API once, and shows its matches in its order', async () => {
    render(<ProductSearch products={products} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    const box = screen.getByRole('searchbox')
    fireEvent.change(box, { target: { value: 'd' } })
    fireEvent.change(box, { target: { value: 'de' } })
    fireEvent.change(box, { target: { value: 'desk' } })
    expect(screen.getByRole('status').textContent).toBe('Searching…')
    await vi.waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3))
    expect(api).toHaveBeenCalledTimes(1)
    expect(urlOf(api.mock.lastCall?.[0]).searchParams.get('q')).toBe('desk')
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Standing desk — $450',
      'Desk chair — $120',
      'Desk lamp — $40',
    ])
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('a failed request keeps the previous results', async () => {
    render(<ProductSearch products={products} />)
    const box = screen.getByRole('searchbox')
    fireEvent.change(box, { target: { value: 'lamp' } })
    await vi.waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
    fireEvent.change(box, { target: { value: 'boom' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Search failed; showing the previous results.',
    )
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Desk lamp — $40'])
  })
})

describe('schema-validation.md', () => {
  const raw = [
    { id: 1, email: 'ada@example.com', balance: 10 },
    { id: 2, email: 'not-an-email', balance: 20 },
    { id: 3, email: 'grace@example.com', balance: 'n/a' },
    { id: 4, email: 'linus@example.com', balance: 40 },
  ]

  it('the hand-written schema is a Standard Schema', () => {
    expect(AccountSchema['~standard'].validate(raw[0])).toEqual({ value: raw[0] })
    expect(AccountSchema['~standard'].validate(raw[1])).toEqual({
      issues: [{ message: 'Expected an email', path: ['email'] }],
    })
  })

  it('flags the invalid rows and the toggle shows only them', () => {
    render(<AccountsTable json={raw} />)
    expect(bodyRows()).toHaveLength(4)
    expect(document.querySelectorAll('tbody tr[data-invalid="true"]')).toHaveLength(2)
    expect(document.querySelectorAll('tbody td[aria-invalid="true"]')).toHaveLength(2)
    expect(document.querySelector('span[title="Expected an email"]')?.textContent).toBe(
      'not-an-email ⚠',
    )
    const toggle = screen.getByRole('checkbox', { name: 'Show only the 2 invalid rows' })
    fireEvent.click(toggle)
    expect(bodyRows().map((r) => r[0])).toEqual(['2', '3'])
    fireEvent.click(toggle)
    expect(bodyRows()).toHaveLength(4)
  })
})

describe('url-state.md', () => {
  const users = Array.from({ length: 45 }, (_, i) => ({
    id: i + 1,
    name: i % 2 === 0 ? `Ada ${i + 1}` : `Linus ${i + 1}`,
    age: 20 + i,
  }))

  it('readUrl / writeUrl round-trip, and ignore unknown values', () => {
    const state = readUrl('?q=ada&sort=-age&page=2')
    expect(state).toEqual({
      search: { input: 'ada', query: 'ada', status: 'idle' },
      sorting: { by: [{ id: 'age', desc: true }] },
      pagination: { pageIndex: 1, pageSize: 20 },
    })
    expect(writeUrl(state)).toBe('?q=ada&sort=-age&page=2')
    expect(readUrl('?sort=password&page=-3').sorting.by).toEqual([])
    expect(readUrl('?sort=password&page=-3').pagination.pageIndex).toBe(0)
    expect(writeUrl(readUrl(''))).toBe('')
  })

  it('starts from the URL and writes every change back', async () => {
    window.history.replaceState(null, '', '/users?sort=-age&page=2')
    render(<UrlUsers users={users} />)
    const names = () => screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(names()[0]).toBe('Ada 25 (44)') // page 2 of age descending: the 21st oldest first
    fireEvent.click(screen.getByRole('button', { name: 'Sort by age (desc)' }))
    // asc → desc → none: the next toggle clears the sort; the page resets, and the URL follows.
    expect(window.location.search).toBe('')
    expect(names()[0]).toBe('Ada 1 (20)')

    await act(async () => {
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ada' } })
    })
    expect(window.location.search).toBe('?q=ada')
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(window.location.search).toBe('?q=ada&page=2')
    expect(window.location.pathname).toBe('/users')
  })
})

describe('nextjs-ssr.md (client side)', () => {
  it('initialData shows the rows with no request; a sort change fetches from the route', async () => {
    const api = vi.fn(async (_input: unknown) =>
      json({ rows: [{ id: 9, name: 'Zed', email: 'z@example.com' }], rowCount: 41 }),
    )
    vi.stubGlobal('fetch', api)
    render(
      <HydratedUsers
        firstPage={[{ id: 1, name: 'Ada', email: 'ada@example.com' }]}
        rowCount={41}
        pageIndex={0}
      />,
    )
    await act(async () => {})
    expect(bodyRows()[0]).toContain('Ada')
    expect(api).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /name/i }))
    await vi.waitFor(() => expect(bodyRows()[0]).toContain('Zed'))
    expect(String(api.mock.calls[0]?.[0])).toBe('/api/users?sort=name&page=0&size=20')
  })
})

describe('row-selection-feature.md', () => {
  it('the feature adds a slice with its initial state', () => {
    const feature = rowSelection()
    expect(feature.name).toBe('rowSelection')
    expect(feature.initialState()).toEqual({ selected: [] })
  })

  it('checkboxes select rows, "Select page" selects the visible rows, Clear empties it', () => {
    const users = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, name: `User ${i + 1}` }))
    render(<SelectableUsers users={users} />)
    const count = () => screen.getByText(/selected/).textContent?.split(' selected')[0]
    expect(count()).toBe('0')
    fireEvent.click(screen.getByRole('checkbox', { name: 'User 2' }))
    expect(count()).toBe('1')
    expect((screen.getByRole('checkbox', { name: 'User 2' }) as HTMLInputElement).checked).toBe(
      true,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Select page' }))
    expect(count()).toBe('20')
    fireEvent.click(screen.getByRole('checkbox', { name: 'User 2' }))
    expect(count()).toBe('19')
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(count()).toBe('0')
  })
})

describe('logging-interceptor.md', () => {
  it('the install example records the user actions', async () => {
    const { events } = await import('./logging-interceptor/2-install')
    expect(events).toEqual([
      ['table_action', { action: 'toggleSort' }],
      ['table_action', { action: 'setSearch' }],
    ])
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(events)
  })

  it('reportSlowRuns reports runs over the budget; timeRequests times fetcher requests', async () => {
    const { createTable, pagination, withFetcher } = await import('../../index')
    const track = vi.fn()
    const users = [{ id: 1, name: 'Ada' }]
    const t1 = createTable({ data: users, interceptors: [reportSlowRuns(track, -1)] })
    t1.setOptions({ data: [...users] })
    t1.getRowModel()
    expect(track).toHaveBeenCalledWith('table_slow_run', expect.objectContaining({ rows: 1 }))
    t1.destroy()

    track.mockClear()
    const t2 = createTable({
      rowKey: 'id',
      features: [pagination({ mode: 'server' })],
      fetcher: withFetcher(async () => ({ rows: users, rowCount: 1 })),
      interceptors: [timeRequests(track), trackActions(track)],
    })
    await vi.waitFor(() =>
      expect(track).toHaveBeenCalledWith(
        'table_request',
        expect.objectContaining({ source: 'fetcher' }),
      ),
    )
    t2.destroy()
  })
})

describe('error-reporting.md', () => {
  it('reports error-level diagnostics, redacted, with the fingerprint', () => {
    const tracker = { captureMessage: vi.fn() }
    const table = customersTable(
      [
        { id: 1, name: 'Ada', email: 'ada@example.com' },
        { id: 1, name: 'Grace', email: 'grace@example.com' }, // duplicate id
      ],
      tracker,
    )
    table.getRowModel()
    const calls = tracker.captureMessage.mock.calls as [string, Record<string, unknown>][]
    expect(calls).toHaveLength(1)
    const dup = calls[0]
    expect(dup?.[0]).toBe('DK_DUPLICATE_ROW_KEY in CustomersTable')
    expect(dup?.[1]).toMatchObject({
      level: 'error',
      tags: { code: 'DK_DUPLICATE_ROW_KEY', table: 'CustomersTable' },
    })
    expect(dup?.[1].fingerprint).toEqual([expect.stringMatching(/^DK_DUPLICATE_ROW_KEY@/)])
    const sent = JSON.stringify(calls)
    expect(sent).not.toContain('example.com')
    expect(sent).not.toContain('Grace')
    table.destroy()
  })

  it('skips info-level diagnostics', () => {
    const tracker = { captureMessage: vi.fn() }
    reportDiagnostics(tracker)({ level: 'info' } as never)
    expect(tracker.captureMessage).not.toHaveBeenCalled()
  })
})

describe('theming.md', () => {
  it('renders the table inside the theme wrapper', () => {
    render(<ThemedUsers users={[{ id: 1, name: 'Ada', age: 36 }]} />)
    expect(document.querySelector('.users-table [data-datakable]')).toBeTruthy()
  })

  it("the page's CSS themes the table, and data-theme overrides the system setting", () => {
    const root = `${import.meta.dirname}/../../../../..`
    const base = fs.readFileSync(`${root}/packages/react/src/styles.css`, 'utf8')
    const page = fs.readFileSync(`${root}/docs/examples/theming.md`, 'utf8')
    const css = /```css\n([\s\S]*?)```/.exec(page)?.[1] ?? ''
    expect(css.startsWith('@import "datakable/styles.css";')).toBe(true)
    const style = document.createElement('style')
    style.textContent = base + css.replace(/^@import[^;]*;/, '')
    document.head.append(style)
    const themed = (theme?: string) => {
      if (theme) document.documentElement.setAttribute('data-theme', theme)
      const { unmount } = render(<ThemedUsers users={[{ id: 1, name: 'Ada', age: 36 }]} />)
      const vars = getComputedStyle(document.querySelector('[data-datakable]') as Element)
      const out = ['--dk-accent', '--dk-radius', '--dk-bg'].map((v) => vars.getPropertyValue(v))
      unmount()
      document.documentElement.removeAttribute('data-theme')
      return out
    }
    try {
      expect(themed()).toEqual(['#7c3aed', '10px', '#fff'])
      expect(themed('dark')).toEqual(['#7c3aed', '10px', '#0d1117'])
      expect(themed('light')).toEqual(['#7c3aed', '10px', '#fff'])
    } finally {
      style.remove()
    }
  })

  it('every --dk-* variable the page sets exists in styles.css', () => {
    const root = `${import.meta.dirname}/../../../../..`
    const page = fs.readFileSync(`${root}/docs/examples/theming.md`, 'utf8')
    const css = fs.readFileSync(`${root}/packages/react/src/styles.css`, 'utf8')
    const defined = new Set(css.match(/--dk-[a-z-]+(?=:)/g))
    const used = new Set(page.match(/--dk-[a-z-]+/g))
    expect(used.size).toBeGreaterThan(3)
    expect([...used].filter((v) => !defined.has(v))).toEqual([])
  })
})

describe('large-data.md', () => {
  it('100k rows: one page of 50 rendered; search applies after the debounce', async () => {
    const trades = Array.from({ length: 100_000 }, (_, i) => ({
      id: i + 1,
      symbol: ['AAPL', 'MSFT', 'NVDA', 'TSLA'][i % 4] as string,
      side: i % 2 === 0 ? ('buy' as const) : ('sell' as const),
      qty: (i * 37) % 1000,
      at: new Date(Date.UTC(2026, 0, 1, 9, 30) + i * 1000),
    }))
    render(<TradesTable trades={trades} />)
    await act(async () => {})
    expect(bodyRows()).toHaveLength(50)
    expect(bodyRows()[0]).toEqual(['AAPL', 'buy', '0', '09:30:00'])
    expect(screen.getByText('Page 1 of 2000')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'NVDA' } })
    await vi.waitFor(() => expect(bodyRows()[0]?.[0]).toBe('NVDA'), { timeout: 10_000 })
    expect(bodyRows().every((r) => r[0] === 'NVDA')).toBe(true)
  }, 30_000)
})
