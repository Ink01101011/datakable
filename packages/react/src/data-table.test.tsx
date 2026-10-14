import {
  type ColumnDef,
  type Diagnostic,
  type FetchResult,
  pagination,
  type RowModelStatus,
  search,
  sorting,
} from '@datakable/core'
import { withSchema } from '@datakable/core/schema'
import { withFetcher } from '@datakable/core/server'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { type ReactNode, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { makeSchema, userCheck } from '../../core/src/ingest/test-schemas'
import { DataTable, type DataTableComponents } from './data-table'
import { useDataTable } from './use-data-table'

type User = { id: number; name: string; age: number }
const users: User[] = [
  { id: 1, name: 'Mali', age: 31 },
  { id: 2, name: 'Anan', age: 25 },
  { id: 3, name: 'Ploy', age: 40 },
]

let consoleError: MockInstance
let consoleWarn: MockInstance
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  consoleError.mockRestore()
  consoleWarn.mockRestore()
})

const flush = () => act(async () => {})
/** Body rows (the header row is in the first rowgroup). */
const bodyRows = () =>
  within(screen.getAllByRole('rowgroup')[1] as HTMLElement).queryAllByRole('row')
const names = () => bodyRows().map((r) => within(r).getAllByRole('cell')[1]?.textContent)
const root = (c: HTMLElement) => c.querySelector('[data-datakable]') as HTMLElement

/** A `<DataTable table={useDataTable(...)} />` with the given hook options. */
function Hooked(props: {
  options: Record<string, unknown>
  components?: DataTableComponents
  expose?: (t: unknown) => void
}) {
  const t = useDataTable(props.options as never)
  props.expose?.(t)
  return <DataTable table={t} {...(props.components ? { components: props.components } : {})} />
}

describe('<DataTable /> (§10)', () => {
  it('renders a zero-config table from data: a header per derived column, a row per item', () => {
    render(<DataTable data={users} />)
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'id',
      'name',
      'age',
    ])
    expect(names()).toEqual(['Mali', 'Anan', 'Ploy'])
    // @datakable/react installs no features: no sort buttons, search or pagination.
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('searchbox')).toBeNull()
  })

  it('uses column headers and cell renderers', () => {
    const columns: ColumnDef<User, ReactNode>[] = [
      { key: 'name', header: 'Name', cell: ({ value }) => <b>{value.toUpperCase()}</b> },
      { id: 'label', header: 'Label', accessor: (u) => `${u.name} (${u.age})` },
      { key: 'age', header: 'Age', format: (v) => `${v} y` },
    ]
    render(<DataTable data={users} columns={columns} />)
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Name',
      'Label',
      'Age',
    ])
    const first = within(bodyRows()[0] as HTMLElement).getAllByRole('cell')
    expect(first.map((c) => c.textContent)).toEqual(['MALI', 'Mali (31)', '31 y'])
    expect(first[0]?.querySelector('b')).toBeTruthy()
  })

  it('sort headers: click toggles asc → desc → none with aria-sort; Shift+click adds a column', () => {
    render(<Hooked options={{ data: users, features: [sorting()] }} />)
    const header = () => screen.getByRole('columnheader', { name: /age/ })
    expect(header().getAttribute('aria-sort')).toBe('none')
    const button = within(header()).getByRole('button')
    fireEvent.click(button)
    expect(header().getAttribute('aria-sort')).toBe('ascending')
    expect(names()).toEqual(['Anan', 'Mali', 'Ploy'])
    fireEvent.click(button)
    expect(header().getAttribute('aria-sort')).toBe('descending')
    expect(names()).toEqual(['Ploy', 'Mali', 'Anan'])
    fireEvent.click(button)
    expect(header().getAttribute('aria-sort')).toBe('none')
    expect(names()).toEqual(['Mali', 'Anan', 'Ploy'])

    fireEvent.click(within(screen.getByRole('columnheader', { name: /name/ })).getByRole('button'))
    fireEvent.click(button, { shiftKey: true })
    expect(screen.getByRole('columnheader', { name: /name/ }).getAttribute('aria-sort')).toBe(
      'ascending',
    )
    expect(header().getAttribute('aria-sort')).toBe('ascending')
  })

  it('a column with sortable: false has no sort button and no aria-sort', () => {
    const columns: ColumnDef<User, ReactNode>[] = [{ key: 'name', sortable: false }, { key: 'age' }]
    render(<Hooked options={{ data: users, columns, features: [sorting()] }} />)
    const name = screen.getByRole('columnheader', { name: 'name' })
    expect(within(name).queryByRole('button')).toBeNull()
    expect(name.getAttribute('aria-sort')).toBeNull()
  })

  it('search input is bound to input; typing searches; Esc clears', () => {
    render(<Hooked options={{ data: users, features: [search()] }} />)
    const box = screen.getByRole('searchbox') as HTMLInputElement
    fireEvent.change(box, { target: { value: 'ploy' } })
    expect(box.value).toBe('ploy')
    expect(names()).toEqual(['Ploy'])
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(box.value).toBe('')
    expect(names()).toEqual(['Mali', 'Anan', 'Ploy'])
  })

  it('debounced search shows a pending status; Enter flushes it', async () => {
    vi.useFakeTimers()
    try {
      const { container } = render(
        <Hooked
          options={{
            data: users,
            features: [search({ typing: { strategy: 'debounce', wait: 300 } })],
          }}
        />,
      )
      const box = screen.getByRole('searchbox') as HTMLInputElement
      fireEvent.change(box, { target: { value: 'anan' } })
      expect(box.value).toBe('anan')
      const wrapper = container.querySelector('[data-dk-search]') as HTMLElement
      expect(wrapper.getAttribute('data-status')).toBe('pending')
      expect(within(wrapper).getByRole('status')).toBeTruthy()
      expect(names()).toEqual(['Mali', 'Anan', 'Ploy'])
      await act(async () => {
        fireEvent.keyDown(box, { key: 'Enter' })
      })
      expect(names()).toEqual(['Anan'])
      expect(wrapper.getAttribute('data-status')).toBe('idle')
      expect(within(wrapper).queryByRole('status')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('pagination: page text, next / previous buttons with disabled state', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: i, name: `n${i}`, age: i }))
    render(<Hooked options={{ data: many, features: [pagination()] }} />)
    const nav = screen.getByRole('navigation', { name: 'Pagination' })
    const prev = within(nav).getByRole('button', { name: 'Previous page' }) as HTMLButtonElement
    const next = within(nav).getByRole('button', { name: 'Next page' }) as HTMLButtonElement
    expect(nav.textContent).toContain('Page 1 of 3')
    expect(prev.disabled).toBe(true)
    expect(bodyRows()).toHaveLength(10)
    fireEvent.click(next)
    fireEvent.click(next)
    expect(nav.textContent).toContain('Page 3 of 3')
    expect(next.disabled).toBe(true)
    expect(bodyRows()).toHaveLength(5)
    fireEvent.click(prev)
    expect(nav.textContent).toContain('Page 2 of 3')
  })

  it('Empty when loaded with zero rows (no data, or no matches)', () => {
    const { unmount } = render(<DataTable data={[] as User[]} />)
    expect(screen.getByText('No rows')).toBeTruthy()
    unmount()
    render(<Hooked options={{ data: users, features: [search()] }} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzzzz' } })
    expect(screen.getByText('No matching rows')).toBeTruthy()
  })
})

describe('<DataTable /> inline data with new row objects (R11 BUG: render loop)', () => {
  // Counted where the data is created, outside any of <DataTable />'s error boundaries (a throw in
  // a `cell` would be caught by its per-cell boundary): the cap makes a loop fail the test instead
  // of hanging it.
  const RENDER_CAP = 60
  let renders = 0
  const count = () => {
    if (++renders > RENDER_CAP) throw new Error(`render loop: ${renders} renders`)
  }
  const columns: ColumnDef<User, ReactNode>[] = [{ key: 'age' }, { key: 'name' }]
  beforeEach(() => {
    renders = 0
  })
  const tick = () => fireEvent.click(screen.getByRole('button', { name: 'tick' }))
  const sortAge = () =>
    fireEvent.click(within(screen.getByRole('columnheader', { name: /age/ })).getByRole('button'))

  it('table={useDataTable({ data: [{ … }] })} in the same component: sorting and re-renders do not loop', () => {
    function Users() {
      count()
      const [, setTick] = useState(0)
      const table = useDataTable({
        data: users.map((u) => ({ ...u })),
        columns,
        features: [sorting()],
      })
      return (
        <>
          <button type="button" onClick={() => setTick((n) => n + 1)}>
            tick
          </button>
          <DataTable table={table} />
        </>
      )
    }
    render(<Users />)
    sortAge()
    expect(names()).toEqual(['Anan', 'Mali', 'Ploy'])
    tick()
    sortAge()
    expect(names()).toEqual(['Ploy', 'Mali', 'Anan'])
    expect(renders).toBeLessThan(20)
  })

  it('<DataTable data={[{ … }]} /> in a re-rendering parent: sorting does not loop', () => {
    function Parent() {
      count()
      const [, setTick] = useState(0)
      return (
        <>
          <button type="button" onClick={() => setTick((n) => n + 1)}>
            tick
          </button>
          <DataTable data={users.map((u) => ({ ...u }))} columns={columns} features={[sorting()]} />
        </>
      )
    }
    render(<Parent />)
    tick()
    sortAge()
    expect(names()).toEqual(['Anan', 'Mali', 'Ploy'])
    tick()
    expect(names()).toEqual(['Anan', 'Mali', 'Ploy'])
    expect(renders).toBeLessThan(20)
  })
})

describe('<DataTable columns={inline array} /> (#23)', () => {
  it('reports DK_UNSTABLE_COLUMNS once after two parent re-renders, like useDataTable', () => {
    const codes: string[] = []
    let rerender = () => {}
    function Parent() {
      const [n, setN] = useState(0)
      rerender = () => setN(n + 1)
      return (
        <DataTable
          data={users}
          rowKey="id"
          columns={[{ key: 'id' }, { key: 'name' }]}
          onDiagnostic={(d) => codes.push(d.code)}
        />
      )
    }
    render(<Parent />)
    act(() => rerender())
    expect(codes).not.toContain('DK_UNSTABLE_COLUMNS')
    for (let i = 0; i < 4; i++) act(() => rerender())
    expect(codes.filter((c) => c === 'DK_UNSTABLE_COLUMNS')).toHaveLength(1)
  })

  it('stable columns across parent re-renders report nothing', () => {
    const codes: string[] = []
    const columns = [{ key: 'id' }, { key: 'name' }] as const
    let rerender = () => {}
    function Parent() {
      const [n, setN] = useState(0)
      rerender = () => setN(n + 1)
      return <DataTable data={users} columns={columns} onDiagnostic={(d) => codes.push(d.code)} />
    }
    render(<Parent />)
    for (let i = 0; i < 4; i++) act(() => rerender())
    expect(codes.filter((c) => c.startsWith('DK_UNSTABLE'))).toEqual([])
  })
})

describe('<DataTable /> states (status + isInitialLoad, §6.6, USER DECISION)', () => {
  /** A fetcher whose results the test resolves. */
  function deferredFetcher() {
    const calls: { resolve: (r: FetchResult<User>) => void; reject: (e: unknown) => void }[] = []
    const fetcher = () =>
      new Promise<FetchResult<User>>((resolve, reject) => calls.push({ resolve, reject }))
    return { calls, fetcher }
  }

  it('Loading on the first fetch; rows after; a refresh indicator over stale rows on refetch', async () => {
    const { calls, fetcher } = deferredFetcher()
    const { container } = render(
      <Hooked
        options={{ fetcher: withFetcher(fetcher), features: [sorting({ mode: 'server' })] }}
      />,
    )
    const r = root(container)
    expect(r.getAttribute('data-status')).toBe('fetching')
    expect(r.getAttribute('data-initial-load')).toBe('true')
    expect(r.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(screen.queryByText('No rows')).toBeNull()

    await act(async () => calls[0]?.resolve({ rows: users, rowCount: 3 }))
    expect(r.getAttribute('data-status')).toBe('idle')
    expect(r.getAttribute('data-initial-load')).toBe('false')
    expect(r.getAttribute('aria-busy')).toBeNull()
    expect(names()).toEqual(['Mali', 'Anan', 'Ploy'])
    expect(container.querySelector('[data-dk-refresh]')).toBeNull()

    // A sort change refetches: the old rows stay, with a refresh indicator.
    fireEvent.click(within(screen.getByRole('columnheader', { name: /age/ })).getByRole('button'))
    expect(r.getAttribute('data-status')).toBe('fetching')
    expect(names()).toEqual(['Mali', 'Anan', 'Ploy'])
    expect(screen.queryByText('Loading…')).toBeNull()
    const refresh = container.querySelector('[data-dk-refresh]') as HTMLElement
    expect(refresh.getAttribute('data-status')).toBe('fetching')
    expect(refresh.getAttribute('role')).toBe('status')
    await act(async () => calls[1]?.resolve({ rows: [users[1] as User], rowCount: 1 }))
    expect(names()).toEqual(['Anan'])
  })

  it('Error when the first request fails (nothing behind it); stale rows when a later one fails', async () => {
    const { calls, fetcher } = deferredFetcher()
    const onDiagnostic = vi.fn<(d: Diagnostic) => void>()
    const { container } = render(
      <Hooked
        options={{
          fetcher: withFetcher(fetcher),
          onDiagnostic,
          features: [sorting({ mode: 'server' })],
        }}
      />,
    )
    await act(async () => calls[0]?.reject(new Error('boom')))
    const r = root(container)
    expect(r.getAttribute('data-status')).toBe('error')
    expect(r.getAttribute('data-initial-load')).toBe('true')
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Could not load')
    // Retry refetches.
    await act(async () => {
      fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    })
    await act(async () => calls[1]?.resolve({ rows: users, rowCount: 3 }))
    expect(names()).toEqual(['Mali', 'Anan', 'Ploy'])
    expect(screen.queryByRole('alert')).toBeNull()

    fireEvent.click(within(screen.getByRole('columnheader', { name: /age/ })).getByRole('button'))
    await act(async () => calls[2]?.reject(new Error('boom')))
    expect(r.getAttribute('data-status')).toBe('error')
    expect(r.getAttribute('data-initial-load')).toBe('false')
    expect(names()).toEqual(['Mali', 'Anan', 'Ploy'])
    const refresh = container.querySelector('[data-dk-refresh]') as HTMLElement
    expect(refresh.getAttribute('data-status')).toBe('error')
  })

  it('an empty first result is loaded: Empty, not Loading', async () => {
    const { calls, fetcher } = deferredFetcher()
    render(
      <Hooked
        options={{ fetcher: withFetcher(fetcher), features: [sorting({ mode: 'server' })] }}
      />,
    )
    await act(async () => calls[0]?.resolve({ rows: [], rowCount: 0 }))
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(screen.getByText('No rows')).toBeTruthy()
  })
})

describe('<DataTable /> flagged rows (invalidRows: flag, §5.1)', () => {
  const schema = withSchema(makeSchema(userCheck))
  const raw = [
    { id: 1, name: 'Mali', age: 31 },
    { id: 2, name: 'Anan', age: 'SECRET-123' },
  ]

  it('sets data-invalid / aria-invalid on the row and the broken cell, ⚠, a redacted title', () => {
    render(<DataTable data={raw} schema={schema} invalidRows="flag" />)
    const [ok, bad] = bodyRows() as [HTMLElement, HTMLElement]
    expect(ok.getAttribute('data-invalid')).toBeNull()
    expect(ok.getAttribute('aria-invalid')).toBeNull()
    expect(bad.getAttribute('data-invalid')).toBe('true')
    expect(bad.getAttribute('aria-invalid')).toBe('true')
    // Issue paths only: the schema message embeds the received value.
    expect(bad.getAttribute('title')).toBe('Invalid: age')
    const cells = within(bad).getAllByRole('cell')
    const age = cells[2] as HTMLElement
    expect(age.getAttribute('data-invalid')).toBe('true')
    expect(age.getAttribute('aria-invalid')).toBe('true')
    expect(age.getAttribute('title')).toBe('Invalid: age')
    expect(age.textContent).toBe('SECRET-123 ⚠')
    expect(age.querySelector('[data-dk-invalid-marker]')?.getAttribute('aria-hidden')).toBe('true')
    expect(cells[1]?.getAttribute('data-invalid')).toBeNull()
    expect(cells[1]?.textContent).toBe('Anan')
  })

  it('invalidCell receives the raw value and the cell issues (row.getCellIssues)', () => {
    const invalidCell = vi.fn(
      ({ value, issues }: { value: unknown; issues: readonly unknown[] }) => (
        <i>
          bad {String(issues.length)} {typeof value}
        </i>
      ),
    )
    const columns = [{ key: 'name' }, { key: 'age', invalidCell }] as const
    render(
      <DataTable
        data={raw}
        schema={schema}
        invalidRows="flag"
        columns={columns as unknown as ColumnDef<User, ReactNode>[]}
      />,
    )
    const bad = bodyRows()[1] as HTMLElement
    expect(within(bad).getAllByRole('cell')[1]?.textContent).toBe('bad 1 string')
    const arg = invalidCell.mock.calls[0]?.[0] as unknown as {
      original: unknown
      issues: { path?: unknown }[]
    }
    expect(arg.original).toBe(raw[1])
    expect(arg.issues).toHaveLength(1)
  })
})

describe('<DataTable /> components overrides', () => {
  it('replaces SearchInput, Pagination, Empty, Loading and Error', async () => {
    let fail: (e: unknown) => void = () => {}
    const fetcher = () => new Promise<FetchResult<User>>((_, reject) => (fail = reject))
    const components: DataTableComponents = {
      SearchInput: ({ value, status, onChange }) => (
        <input
          aria-label="find"
          data-s={status}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ),
      Pagination: ({ pageIndex, pageCount, next }) => (
        <button type="button" onClick={next}>
          p{pageIndex + 1}/{pageCount}
        </button>
      ),
      Empty: ({ filtered }) => <span>nothing {String(filtered)}</span>,
      Loading: ({ status }: { status: RowModelStatus }) => <span>wait {status}</span>,
      Error: ({ retry }) => (
        <button type="button" onClick={retry}>
          again
        </button>
      ),
    }
    const { unmount } = render(
      <Hooked
        components={components}
        options={{
          fetcher: withFetcher(fetcher),
          features: [search({ mode: 'server' }), pagination()],
        }}
      />,
    )
    expect(screen.getByText('wait fetching')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'find' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'p1/0' })).toBeTruthy()
    await act(async () => fail(new Error('x')))
    expect(screen.getByRole('button', { name: 'again' })).toBeTruthy()
    unmount()

    render(<Hooked components={components} options={{ data: [], features: [pagination()] }} />)
    expect(screen.getByText('nothing false')).toBeTruthy()
    await flush()
  })
})
