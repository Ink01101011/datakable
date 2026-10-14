import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fences } from './docs-check'
import { normalize } from './errors-doc'
import {
  createTable,
  DataTable,
  type Diagnostic,
  type FetchResult,
  pagination,
  type StandardSchemaV1,
  search,
  sorting,
  useDataTable,
  VERSION,
  withFetcher,
  withSchema,
} from './index'

/**
 * `docs/how-to-fix/` (D3, job datakable-docs-v1): each troubleshooting page's symptom is
 * reproduced here, and the fix the page shows (its compiled example files under
 * `./docs-examples/how-to-fix/`, imported as is) is shown to remove it. ```text blocks are compared
 * with what DataKable prints, as `errors-doc.test.tsx` does for the diagnostics reference.
 */

const ex = './docs-examples/how-to-fix'

const fs = (await import('node:fs' as string)) as {
  readFileSync(path: string, encoding: 'utf8'): string
}

/** The ```text blocks of `docs/how-to-fix/<page>`. */
const textBlocks = (page: string) =>
  fences(fs.readFileSync(`${import.meta.dirname}/../../../docs/how-to-fix/${page}`, 'utf8'))
    .filter((f) => f.lang === 'text')
    .map((f) => f.code)

/** What `console.log` printed while `load` ran, one entry per call (non-strings as JSON). */
async function logged(load: () => Promise<unknown>): Promise<string[]> {
  const out: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
    out.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  })
  try {
    await load()
  } finally {
    spy.mockRestore()
  }
  return out
}

/** Diagnostics reported by a table created with `onDiagnostic: sink.push`. */
const sink = () => {
  const seen: Diagnostic[] = []
  return { seen, push: (d: Diagnostic) => seen.push(d), codes: () => seen.map((d) => d.code) }
}

beforeEach(() => {
  // Keep the dev console sink quiet; tests read diagnostics through onDiagnostic.
  for (const m of ['groupCollapsed', 'groupEnd', 'error', 'warn', 'info'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {})
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** A Standard Schema that accepts rows whose `id` is a number. */
const UserSchema: StandardSchemaV1<unknown, { id: number; name: string }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (v) =>
      typeof (v as { id?: unknown }).id === 'number'
        ? { value: v as { id: number; name: string } }
        : { issues: [{ message: 'expected a number', path: ['id'] }] },
  },
}

describe('no-rows.md', () => {
  it('explain() / explainRow() print what the page shows', async () => {
    const out = await logged(() => import(`${ex}/no-rows/1-explain`))
    const shown = textBlocks('no-rows.md')
    expect(out.map((o) => normalize(o, VERSION))).toEqual(shown.map((s) => normalize(s, VERSION)))
  })

  it('a search that hides every row: the clear button brings the rows back', async () => {
    const { Products } = await import(`${ex}/no-rows/2-clear-filters`)
    const products = [
      { sku: 'A', name: 'Desk chair', price: 120 },
      { sku: 'B', name: 'Desk lamp', price: 40 },
    ]
    const { container, queryByText, getByText } = render(<Products products={products} />)
    const input = container.querySelector('[data-dk-search] input') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: 'zzzz' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(container.textContent).toContain('No matching rows')
    await act(async () => {
      fireEvent.click(getByText('Clear filters and search'))
    })
    expect(queryByText('Clear filters and search')).toBeNull()
    expect(container.textContent).toContain('Desk lamp')
  })

  it('a schema drops every row: explain shows it, invalidRows "flag" keeps them', () => {
    const json: unknown[] = [
      { id: '1', name: 'Ada' },
      { id: '2', name: 'Grace' },
      { id: '3', name: 'Linus' },
    ]
    const s = sink()
    const dropped = createTable({
      data: json,
      rowKey: 'id',
      schema: withSchema(UserSchema),
      onDiagnostic: s.push,
    })
    expect(dropped.getRowModel().rows).toHaveLength(0)
    expect(String(dropped.explain())).toContain('schema 0 (3 dropped)')
    expect(s.seen.find((d) => d.code === 'DK_SCHEMA_INVALID_ROW')?.fix[0]).toContain(
      '3 rows fail at "id"',
    )
    const flagged = createTable({
      data: json,
      rowKey: 'id',
      schema: withSchema(UserSchema),
      invalidRows: 'flag',
    })
    expect(flagged.getRowModel().rows).toHaveLength(3)
    expect(flagged.getInvalidRows().map((r) => r.index)).toEqual([0, 1, 2])
  })

  it('rows under another option name: no data and DK_UNKNOWN_OPTION; `data` shows them', () => {
    const users = [{ id: 1, name: 'Ada' }]
    const s = sink()
    const wrong = createTable({ rows: users, onDiagnostic: s.push } as never) as {
      getRowModel(): { rows: readonly unknown[] }
    }
    expect(wrong.getRowModel().rows).toHaveLength(0)
    expect(s.codes()).toContain('DK_UNKNOWN_OPTION')
    expect(createTable({ data: users }).getRowModel().rows).toHaveLength(1)
  })
})

const users = [
  { id: 1, name: 'Ada', age: 36, city: 'London' },
  { id: 2, name: 'Grace', age: 45, city: 'New York' },
  { id: 3, name: 'Linus', age: 28, city: 'Helsinki' },
]
const names = (t: { getRowModel(): { rows: readonly { original: { name: string } }[] } }) =>
  t.getRowModel().rows.map((r) => r.original.name)

/** A `fetch` stub answering `{ rows, rowCount }`; returns the requested URLs. */
function stubFetch(rows: unknown[] = users) {
  const urls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url)
      return { ok: true, status: 200, json: async () => ({ rows, rowCount: rows.length }) }
    }),
  )
  return urls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sorting-or-filtering-does-nothing.md', () => {
  it('controlled state without onStateChange: DK_CONTROLLED_WITHOUT_HANDLER, sorting frozen', () => {
    const s = sink()
    const t = createTable({
      data: users,
      rowKey: 'id',
      state: { sorting: { by: [] } },
      onDiagnostic: s.push,
    })
    t.toggleSort('age')
    expect(t.getState().sorting.by).toEqual([])
    expect(s.codes()).toContain('DK_CONTROLLED_WITHOUT_HANDLER')
  })

  it('an onStateChange that does not feed the state back: frozen, DK_CONTROLLED_NOT_FED_BACK', () => {
    vi.useFakeTimers()
    const s = sink()
    const t = createTable({
      data: users,
      rowKey: 'id',
      state: { sorting: { by: [] } },
      onStateChange: () => {},
      onDiagnostic: s.push,
    })
    t.toggleSort('age')
    expect(names(t)).toEqual(['Ada', 'Grace', 'Linus'])
    expect(s.codes()).toEqual([])
    vi.advanceTimersByTime(1000)
    vi.useRealTimers()
    expect(s.codes()).toEqual(['DK_CONTROLLED_NOT_FED_BACK'])
  })

  it('the fix: controlled state fed back sorts', async () => {
    const { Users } = await import(`${ex}/sorting-or-filtering-does-nothing/1-controlled`)
    const { container, getByText } = render(<Users users={users} />)
    const list = () => [...container.querySelectorAll('li')].map((li) => li.textContent)
    expect(list()).toEqual(['Ada', 'Grace', 'Linus'])
    act(() => {
      fireEvent.click(getByText('Sort by age'))
    })
    expect(list()).toEqual(['Linus', 'Ada', 'Grace'])
  })

  it('server mode without a fetcher: the state changes, the rows do not', () => {
    const t = createTable({ data: users, rowKey: 'id', features: [sorting({ mode: 'server' })] })
    t.toggleSort('age')
    expect(t.getState().sorting.by).toEqual([{ id: 'age', desc: false }])
    expect(names(t)).toEqual(['Ada', 'Grace', 'Linus'])
    expect(String(t.explain())).toContain('sorting (server)')
  })

  it('the fix: a fetcher receives the sort on every change', async () => {
    const urls = stubFetch()
    const { table } = await import(`${ex}/sorting-or-filtering-does-nothing/2-server-mode`)
    await vi.waitFor(() => expect(table.getRowModel().status).toBe('idle'))
    table.toggleSort('age')
    await vi.waitFor(() => expect(urls.at(-1)).toBe('/api/users?sort=age'))
    expect(urls[0]).toBe('/api/users?sort=')
  })

  it('features replace the preset: only the installed features have methods', () => {
    const sortOnly = createTable({ data: users, features: [sorting()] }) as object
    expect('setColumnFilter' in sortOnly).toBe(false)
    const preset = createTable({ data: users }) as object
    expect('setColumnFilter' in preset).toBe(true)
  })

  it('sorting resets the page to the first one (autoResetPageIndex)', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: i, n: 30 - i }))
    const t = createTable({ data: many, rowKey: 'id' })
    t.nextPage()
    expect(t.getState().pagination.pageIndex).toBe(1)
    t.toggleSort('n')
    expect(t.getState().pagination.pageIndex).toBe(0)
  })
})

describe('search-finds-nothing-or-is-slow.md', () => {
  const page = 'search-finds-nothing-or-is-slow.md'

  it('a debounced query is pending until flushed; the output is what the page shows', async () => {
    const out = await logged(() => import(`${ex}/search-finds-nothing-or-is-slow/1-pending-query`))
    expect(out).toEqual(textBlocks(page).slice(0, 2))
  })

  it('with one weighted column, an unweighted one is not searched; the fix weighs it', async () => {
    const plain = createTable({
      data: users,
      rowKey: 'id',
      columns: [{ key: 'name', search: 1 }, { key: 'city' }],
    })
    await plain.setSearch('London')
    expect(names(plain)).toEqual([])
    expect(String(plain.explainRow(1))).toContain('did not match (threshold 0.3)')
    const out = await logged(
      () => import(`${ex}/search-finds-nothing-or-is-slow/2-searchable-columns`),
    )
    expect(out).toEqual(textBlocks(page).slice(2, 3))
  })

  it('search matches the formatted value, case-insensitively', async () => {
    const t = createTable({
      data: [
        { id: 1, joined: new Date(Date.UTC(2024, 0, 15)) },
        { id: 2, joined: new Date(Date.UTC(2020, 5, 1)) },
      ],
      rowKey: 'id',
      columns: [
        {
          key: 'joined',
          search: 1,
          format: (d) => (d.getUTCFullYear() > 2022 ? 'recent' : 'archived'),
        },
      ],
    })
    await t.setSearch('RECENT')
    expect(t.getRowModel().rows.map((r) => r.key)).toEqual([1])
  })

  it('server mode: debounce and minLength 2 by default', async () => {
    stubFetch()
    const t = createTable({
      rowKey: 'id',
      features: [search({ mode: 'server' })],
      fetcher: withFetcher(async ({ query }) => ({ rows: query ? [] : users, rowCount: 3 })),
    })
    void t.setSearch('ada')
    expect(t.getState().search).toMatchObject({ input: 'ada', query: '', status: 'pending' })
    await t.flushSearch()
    expect(t.getState().search.query).toBe('ada')
    await t.setSearch('a')
    expect(t.getState().search.query).toBe('')
  })
})

describe('endless-re-renders.md', () => {
  it('a table update while rendering re-renders without end; React and DK_LISTENER_FAILED say so', () => {
    const errors = vi.mocked(console.error)
    const s = sink()
    let renders = 0
    function Broken({ status }: { status: string }) {
      const t = useDataTable({ data: users, rowKey: 'id', onDiagnostic: s.push })
      renders++
      // A guard so the test ends; without it this never stops.
      if (renders < 100) t.setColumnFilter('city', { type: 'equals', value: status })
      return <p>{t.rowModel.filteredCount}</p>
    }
    render(<Broken status="London" />)
    expect(renders).toBe(100)
    expect(s.codes()).toContain('DK_LISTENER_FAILED')
    expect(errors.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(
      /Cannot update a component/,
    )
  })

  it('the fix: initialState, then an effect when the prop changes', async () => {
    const { Orders } = await import(`${ex}/endless-re-renders/1-update-after-render`)
    const orders = [
      { id: 1, customer: 'Ada', status: 'open' },
      { id: 2, customer: 'Grace', status: 'paid' },
      { id: 3, customer: 'Linus', status: 'open' },
    ]
    const { container, rerender } = render(<Orders orders={orders} status="open" />)
    expect(container.textContent).toBe('2 orders')
    rerender(<Orders orders={orders} status="paid" />)
    expect(container.textContent).toBe('1 orders')
  })

  it('a listener that always updates: DK_UPDATE_LOOP; the fix updates only when needed', async () => {
    const s = sink()
    const t = createTable({ data: users, rowKey: 'id', onDiagnostic: s.push })
    t.subscribe((state) => t.setSorting([...state.sorting.by, { id: 'name', desc: false }]))
    t.toggleSort('city')
    expect(s.codes()).toContain('DK_UPDATE_LOOP')
    const out = await logged(() => import(`${ex}/endless-re-renders/2-listener`))
    expect(out).toEqual(textBlocks('endless-re-renders.md'))
  })

  it('inline columns and data: no loop, DK_UNSTABLE_* in development; the fix reports none', async () => {
    const s = sink()
    let renders = 0
    function Inline({ minAge }: { minAge: number }) {
      renders++
      const t = useDataTable({
        data: users.filter((u) => u.age >= minAge),
        rowKey: 'id',
        columns: [{ key: 'name' }, { key: 'age' }],
        onDiagnostic: s.push,
      })
      return <p>{t.rowModel.filteredCount}</p>
    }
    const inline = render(<Inline minAge={30} />)
    for (let i = 0; i < 3; i++) inline.rerender(<Inline minAge={30} />)
    expect(renders).toBeLessThan(10)
    expect(s.codes()).toEqual(expect.arrayContaining(['DK_UNSTABLE_COLUMNS', 'DK_UNSTABLE_OPTION']))
    const { Adults } = await import(`${ex}/endless-re-renders/3-stable-options`)
    vi.mocked(console.groupCollapsed).mockClear()
    const r = render(<Adults users={users} minAge={30} />)
    for (let i = 0; i < 3; i++) r.rerender(<Adults users={users} minAge={30} />)
    expect(r.container.textContent).toBe('2 adults')
    // The dev console sink prints each diagnostic as a group header: none this time.
    const headers = vi.mocked(console.groupCollapsed).mock.calls.map((c) => String(c[0]))
    expect(headers.filter((h) => h.includes('DK_UNSTABLE'))).toEqual([])
  })
})

/** A `fetch` stub driven by `answer` (status, body); returns the signals it got. */
function stubFetchWith(answer: (url: string) => { status: number; body: unknown } | 'never') {
  const signals: AbortSignal[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: { signal?: AbortSignal }) => {
      if (init?.signal) signals.push(init.signal)
      const a = answer(url)
      if (a === 'never') return new Promise(() => {})
      return Promise.resolve({
        ok: a.status < 400,
        status: a.status,
        json: async () => a.body,
      })
    }),
  )
  return signals
}

describe('loading-never-ends.md', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a request that never settles: fetching until the timeout, then error + DK_ASYNC_TIMEOUT', async () => {
    vi.useFakeTimers()
    const signals = stubFetchWith(() => 'never')
    const { table } = await import(`${ex}/loading-never-ends/2-signal-and-timeout`)
    const s = sink()
    table.setOptions({ onDiagnostic: s.push })
    expect(table.getRowModel()).toMatchObject({ status: 'fetching', isInitialLoad: true })
    await vi.advanceTimersByTimeAsync(9_999)
    expect(table.getRowModel().status).toBe('fetching')
    await vi.advanceTimersByTimeAsync(1)
    expect(table.getRowModel()).toMatchObject({ status: 'error', isInitialLoad: true })
    expect(s.codes()).toContain('DK_ASYNC_TIMEOUT')
    expect(signals[0]?.aborted).toBe(true)
  })

  it("after a failure, status stays 'error' until a request applies", async () => {
    let ok = false
    const t = createTable({
      rowKey: 'id',
      features: [pagination({ mode: 'server' })],
      fetcher: withFetcher(async () => {
        if (!ok) throw new Error('HTTP 500')
        return { rows: users, rowCount: 3 }
      }),
    })
    await vi.waitFor(() => expect(t.getRowModel().status).toBe('error'))
    const retry = t.refetch()
    expect(t.getRowModel().status).toBe('error')
    expect(await retry).toEqual({ status: 'error' })
    ok = true
    expect(await t.refetch()).toEqual({ status: 'applied' })
    expect(t.getRowModel()).toMatchObject({ status: 'idle', isInitialLoad: false })
  })

  it('<DataTable /> writes data-status and data-initial-load on its root', async () => {
    const { Users } = await import(`${ex}/loading-never-ends/1-status-attributes`)
    const { container } = render(<Users users={users} />)
    const root = container.querySelector('[data-datakable]') as HTMLElement
    expect(root.getAttribute('data-status')).toBe('idle')
    expect(root.getAttribute('data-initial-load')).toBe('false')
  })
})

describe('fetch-errors-and-retries.md', () => {
  const page = { items: [{ id: 1, name: 'Ada' }], total: 41 }

  it('an HTTP error read as rows is DK_FETCH_BAD_RESPONSE; the fix throws: DK_FETCH_FAILED', async () => {
    stubFetchWith(() => ({ status: 500, body: { error: 'database down' } }))
    const s = sink()
    createTable({
      rowKey: 'id',
      features: [pagination({ mode: 'server' })],
      onDiagnostic: s.push,
      fetcher: withFetcher(
        async () => (await fetch('/api/users')).json() as Promise<FetchResult<{ id: number }>>,
      ),
    })
    await vi.waitFor(() => expect(s.codes()).toContain('DK_FETCH_BAD_RESPONSE'))
    const { table } = await import(`${ex}/fetch-errors-and-retries/1-check-the-response`)
    const fixed = sink()
    table.setOptions({ onDiagnostic: fixed.push })
    await vi.waitFor(() => expect(table.getRowModel().status).toBe('error'))
    expect(fixed.codes()).toEqual(['DK_FETCH_FAILED'])
    expect(fixed.seen[0]?.context.cause).toEqual(new Error('HTTP 500'))
  })

  it('the fix maps { items, total } to { rows, rowCount }', async () => {
    vi.resetModules()
    stubFetchWith(() => ({ status: 200, body: page }))
    const { table } = await import(`${ex}/fetch-errors-and-retries/1-check-the-response`)
    await vi.waitFor(() => expect(table.getRowModel().status).toBe('idle'))
    expect(table.getRowModel().rows.map((r: { key: unknown }) => r.key)).toEqual([1])
    expect(table.getPageCount()).toBe(3)
  })

  it('refetchWithRetry: waits 1 s, 2 s between attempts and stops on success', async () => {
    vi.useFakeTimers()
    try {
      const { refetchWithRetry } = await import(`${ex}/fetch-errors-and-retries/2-retry`)
      const outcomes = ['error', 'error', 'applied'] as const
      let calls = 0
      const table = { refetch: async () => ({ status: outcomes[calls++] ?? 'applied' }) }
      const done = refetchWithRetry(table)
      await vi.advanceTimersByTimeAsync(999)
      expect(calls).toBe(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(calls).toBe(2)
      await vi.advanceTimersByTimeAsync(2000)
      expect(await done).toBe('applied')
      expect(calls).toBe(3)
      let failing = 0
      const down = {
        refetch: async () => {
          failing++
          return { status: 'error' as const }
        },
      }
      const gaveUp = refetchWithRetry(down, 2)
      await vi.advanceTimersByTimeAsync(1000)
      expect(await gaveUp).toBe('error')
      expect(failing).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a failed first load shows the Error part; Try again loads the rows', async () => {
    let up = false
    stubFetchWith(() =>
      up
        ? { status: 200, body: { rows: [{ id: 1, name: 'Ada' }], rowCount: 1 } }
        : { status: 503, body: {} },
    )
    const { Users } = await import(`${ex}/fetch-errors-and-retries/3-error-state`)
    const { findByText, getByText, container } = render(<Users />)
    await findByText('Could not load the users.', { exact: false })
    expect(vi.mocked(console.error).mock.calls.some((c) => c[0] === 'users request failed')).toBe(
      true,
    )
    up = true
    await act(async () => {
      fireEvent.click(getByText('Try again'))
    })
    await vi.waitFor(() => expect(container.textContent).toContain('Ada'))
  })
})

describe('ssr-and-hydration.md', () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  let root: Root | undefined
  let container: HTMLElement
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    localStorage.clear()
  })
  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    container.remove()
  })
  /** The server HTML of `el`, then `el` hydrated over it (`beforeHydrate` runs in between). */
  async function ssrThenHydrate(el: ReactElement, beforeHydrate?: () => void) {
    container.innerHTML = renderToString(el)
    const html = container.innerHTML
    beforeHydrate?.()
    await act(async () => {
      root = hydrateRoot(container, el)
    })
    return html
  }
  const hydrationErrors = () =>
    vi
      .mocked(console.error)
      .mock.calls.filter((c) => /hydrat|did not match/i.test(c.map(String).join(' ')))

  it('without initialData the server HTML is Loading (pending); with it, the rows, no refetch', async () => {
    const urls = stubFetch()
    const { Users } = await import(`${ex}/ssr-and-hydration/1-initial-data`)
    const empty = renderToString(
      <DataTable
        rowKey="id"
        features={[pagination({ mode: 'server' })]}
        fetcher={withFetcher(async () => ({ rows: users, rowCount: 3 }))}
      />,
    )
    expect(empty).toContain('data-status="pending"')
    const html = await ssrThenHydrate(<Users firstPage={users} rowCount={41} />)
    expect(html).toContain('Grace')
    expect(html).toContain('data-status="idle"')
    expect(hydrationErrors()).toEqual([])
    expect(urls).toEqual([])
  })

  it('browser-only state while rendering breaks hydration; applied in an effect it does not', async () => {
    const saved = JSON.stringify({ by: [{ id: 'age', desc: false }] })
    function Broken({ list }: { list: typeof users }) {
      const fromStorage = localStorage.getItem('users.sorting')
      const t = useDataTable({
        data: list,
        rowKey: 'id',
        ...(fromStorage ? { initialState: { sorting: JSON.parse(fromStorage) } } : {}),
      })
      return (
        <ul>
          {t.rowModel.rows.map((r) => (
            <li key={r.key}>{r.original.name}</li>
          ))}
        </ul>
      )
    }
    // The server has no localStorage entry; the browser has one.
    await ssrThenHydrate(<Broken list={users} />, () =>
      localStorage.setItem('users.sorting', saved),
    )
    expect(hydrationErrors().length).toBeGreaterThan(0)
    act(() => root?.unmount())
    root = undefined
    vi.mocked(console.error).mockClear()
    localStorage.clear()

    const { Users } = await import(`${ex}/ssr-and-hydration/2-client-only-state`)
    const html = await ssrThenHydrate(<Users users={users} />, () =>
      localStorage.setItem('users.sorting', saved),
    )
    expect(html).toContain('<li>Ada</li><li>Grace</li><li>Linus</li>')
    expect(hydrationErrors()).toEqual([])
    expect(container.textContent).toBe('LinusAdaGrace')
  })

  it('a table changed while hydrating reports DK_HYDRATION_MISMATCH', async () => {
    const s = sink()
    let client = false
    function ChangesWhileRendering() {
      const t = useDataTable({ data: users, rowKey: 'id', onDiagnostic: s.push })
      if (client && t.state.sorting.by.length === 0) t.toggleSort('age')
      return <p>{t.rowModel.rows[0]?.original.name}</p>
    }
    await ssrThenHydrate(<ChangesWhileRendering />, () => {
      client = true
    })
    expect(s.codes()).toContain('DK_HYDRATION_MISMATCH')
  })

  it('dates formatted with a fixed locale and time zone', async () => {
    const { columns } = await import(`${ex}/ssr-and-hydration/3-format-dates`)
    const placed = new Date(Date.UTC(2024, 0, 15, 10, 30))
    const html = renderToString(
      <DataTable data={[{ id: 1, placed }]} rowKey="id" columns={columns} />,
    )
    expect(html).toContain('15 Jan 2024, 10:30')
  })
})

describe('bundle-too-big.md', () => {
  it('the budget table is the §9.3 budgets of scripts/size-limits.mjs', async () => {
    const limits = (
      (await import('../../../scripts/size-limits.mjs' as string)) as {
        default: { pkg: string; import: string[]; budget?: number }[]
      }
    ).default
    const page = fs.readFileSync(
      `${import.meta.dirname}/../../../docs/how-to-fix/bundle-too-big.md`,
      'utf8',
    )
    const shown = [
      ...page.matchAll(/^\| `(@datakable\/core|datakable)`: (.+?) \| ≤ ([\d.]+) KB \|$/gm),
    ]
    const budgets = limits.filter((l) => l.budget !== undefined)
    expect(shown.map((m) => Number(m[3]) * 1024)).toEqual(budgets.map((l) => l.budget))
    expect(shown.map((m) => m[1])).toEqual(
      budgets.map((l) => (l.pkg === 'core' ? '@datakable/core' : 'datakable')),
    )
  })

  it('a features subset renders no search box and keeps sorting', async () => {
    const { Users } = await import(`${ex}/bundle-too-big/1-preset-subset`)
    const { container } = render(<Users users={users} />)
    expect(container.querySelector('[data-dk-search]')).toBeNull()
    expect(container.querySelector('th button')).not.toBeNull()
  })
})

describe('large-data.md', () => {
  it('one page of Row objects for 100,000 rows', async () => {
    const out = await logged(() => import(`${ex}/large-data/1-paginate`))
    expect(out).toEqual(['50 100000'])
  })
})
