import { type FetchResult, pagination, search, sorting } from '@datakable/core'
import { withFetcher } from '@datakable/core/server'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { DataTable } from './data-table'
import { useDataTable } from './use-data-table'

// Accessibility of the default parts (#54–#60): names, live status, focus.

type User = { id: number; name: string; city: string }
const users: User[] = Array.from({ length: 25 }, (_, i) => ({
  id: i + 1,
  name: `User ${i + 1}`,
  city: i % 5 ? 'Oslo' : 'Kyoto',
}))

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

function Hooked(props: { options: Record<string, unknown>; caption?: string }) {
  return <DataTable table={useDataTable(props.options as never) as never} caption={props.caption} />
}

describe('a failed cell has a text alternative (#60)', () => {
  it('the ⚠ of a throwing cell is an image named "Could not display this value"', () => {
    render(
      <DataTable
        data={users.slice(0, 3)}
        columns={[
          { key: 'id' },
          {
            key: 'name',
            cell: ({ value }: { value: unknown }) => {
              if (value === 'User 2') throw new Error('x')
              return value as string
            },
          },
        ]}
      />,
    )
    const cell = screen.getAllByRole('row')[2]?.querySelectorAll('td')[1] as HTMLElement
    expect(cell.textContent).toBe('⚠')
    expect(within(cell).getByRole('img').getAttribute('aria-label')).toBe(
      'Could not display this value',
    )
  })

  it('so is the ⚠ of a cell whose component throws while React renders it', () => {
    const Boom = (): never => {
      throw new Error('x')
    }
    render(
      <DataTable
        data={users.slice(0, 1)}
        columns={[{ key: 'id' }, { key: 'name', cell: () => <Boom /> }]}
      />,
    )
    const cell = screen.getAllByRole('row')[1]?.querySelectorAll('td')[1] as HTMLElement
    expect(within(cell).getByRole('img', { name: 'Could not display this value' })).toBeTruthy()
  })
})

describe('the search box and pager are named after the caption (#59)', () => {
  it('two tables on a page get distinct search and navigation names', () => {
    const features = () => [search(), pagination()]
    render(
      <>
        <Hooked caption="Customers" options={{ data: users, features: features() }} />
        <Hooked caption="Suppliers" options={{ data: users, features: features() }} />
      </>,
    )
    expect(screen.getAllByRole('searchbox').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Search Customers',
      'Search Suppliers',
    ])
    expect(screen.getAllByRole('navigation').map((n) => n.getAttribute('aria-label'))).toEqual([
      'Customers pagination',
      'Suppliers pagination',
    ])
  })

  it('without a text caption the names stay "Search" and "Pagination"; custom parts get the label', () => {
    const seen: string[] = []
    render(
      <DataTable
        data={users}
        features={[search(), pagination()]}
        components={{
          SearchInput: (p) => {
            seen.push(p.label)
            return null
          },
        }}
      />,
    )
    expect(seen.at(-1)).toBe('Search')
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeTruthy()
  })
})

describe('paging to the first / last page keeps focus on the pager button (#55)', () => {
  it('the unavailable button is aria-disabled, stays focusable and ignores activation', () => {
    render(<DataTable data={users} features={[pagination()]} />)
    const nav = screen.getByRole('navigation', { name: 'Pagination' })
    const prev = within(nav).getByRole('button', { name: 'Previous page' }) as HTMLButtonElement
    const next = within(nav).getByRole('button', { name: 'Next page' }) as HTMLButtonElement
    expect(prev.getAttribute('aria-disabled')).toBe('true')
    expect(next.getAttribute('aria-disabled')).toBeNull()
    next.focus()
    fireEvent.click(next)
    fireEvent.click(next)
    expect(nav.textContent).toContain('Page 3 of 3')
    // A disabled element cannot hold focus (the browser moves it to <body>): never `disabled`.
    expect(next.disabled).toBe(false)
    expect(next.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(next)
    fireEvent.click(next)
    expect(nav.textContent).toContain('Page 3 of 3')
    expect(prev.getAttribute('aria-disabled')).toBeNull()
  })
})

describe('Retry moves focus to the table before its button goes away (#56)', () => {
  function deferredFetcher() {
    const calls: { resolve: (r: FetchResult<User>) => void; reject: (e: unknown) => void }[] = []
    const fetcher = () =>
      new Promise<FetchResult<User>>((resolve, reject) => calls.push({ resolve, reject }))
    return { calls, fetcher: withFetcher(fetcher) }
  }

  it('load error: focus goes to the table, not <body>', async () => {
    const { calls, fetcher } = deferredFetcher()
    render(
      <Hooked caption="Users" options={{ fetcher, features: [sorting({ mode: 'server' })] }} />,
    )
    await act(async () => calls[0]?.reject(new Error('boom')))
    const retry = within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' })
    retry.focus()
    await act(async () => fireEvent.click(retry))
    await act(async () => calls[1]?.resolve({ rows: users.slice(0, 3), rowCount: 3 }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('table'))
  })

  it('refresh error: focus goes to the table, not <body>', async () => {
    const { calls, fetcher } = deferredFetcher()
    render(<Hooked options={{ fetcher, features: [sorting({ mode: 'server' })] }} />)
    await act(async () => calls[0]?.resolve({ rows: users.slice(0, 3), rowCount: 3 }))
    fireEvent.click(within(screen.getByRole('columnheader', { name: /name/ })).getByRole('button'))
    await act(async () => calls[1]?.reject(new Error('boom')))
    const retry = within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' })
    retry.focus()
    await act(async () => fireEvent.click(retry))
    expect(document.activeElement).toBe(screen.getByRole('table'))
  })

  it('render error (a part in the body threw): focus goes to the table, not <body>', () => {
    let fail = true
    const Empty = () => {
      if (fail) throw new Error('boom')
      return 'none'
    }
    render(<DataTable data={[] as User[]} components={{ Empty }} />)
    const retry = within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' })
    retry.focus()
    fail = false
    fireEvent.click(retry)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('table'))
  })

  it('a retry while focus is elsewhere (the search box) leaves focus alone', async () => {
    const { calls, fetcher } = deferredFetcher()
    let table: { refetch(): Promise<unknown> } | undefined
    function Exposed() {
      const t = useDataTable({ fetcher, features: [search({ mode: 'server' })] } as never)
      table = t as never
      return <DataTable table={t as never} />
    }
    render(<Exposed />)
    await act(async () => calls[0]?.reject(new Error('boom')))
    const box = screen.getByRole('searchbox')
    box.focus()
    await act(async () => void table?.refetch())
    expect(document.activeElement).toBe(box)
  })
})

describe('status messages: one persistent polite live region (#54)', () => {
  const live = (c: HTMLElement) => c.querySelector('[data-datakable] > [aria-live="polite"]')

  it('is in the markup from the first render (server HTML too), empty until something changes', () => {
    const html = renderToString(<DataTable data={users} features={[search(), pagination()]} />)
    expect(html).toMatch(/<div aria-live="polite"[^>]*><\/div><\/div>$/)
    const { container } = render(<DataTable data={users} features={[search(), pagination()]} />)
    expect(live(container)?.textContent).toBe('')
  })

  it('announces search results, no results and page changes', () => {
    const { container } = render(<DataTable data={users} features={[search(), pagination()]} />)
    const box = screen.getByRole('searchbox')
    fireEvent.change(box, { target: { value: 'kyoto' } })
    expect(live(container)?.textContent).toBe('5 rows, page 1 of 1')
    fireEvent.change(box, { target: { value: 'zzzz' } })
    expect(live(container)?.textContent).toBe('0 rows, page 1 of 1')
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(live(container)?.textContent).toBe('25 rows, page 1 of 3')
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(live(container)?.textContent).toBe('25 rows, page 2 of 3')
  })

  it('announces "Searching rows…" while a debounced search waits; the spinner is not an empty status', async () => {
    vi.useFakeTimers()
    try {
      const { container } = render(
        <DataTable data={users} features={[search({ typing: { strategy: 'debounce' } })]} />,
      )
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'kyoto' } })
      expect(live(container)?.textContent).toBe('Searching rows…')
      const spinner = container.querySelector('[data-dk-spinner]') as HTMLElement
      expect(spinner.getAttribute('role')).toBeNull()
      expect(spinner.getAttribute('aria-hidden')).toBe('true')
      await act(async () => {
        fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' })
      })
      expect(live(container)?.textContent).toBe('5 rows')
    } finally {
      vi.useRealTimers()
    }
  })

  it('server mode: the first load and a refetch end with the page status', async () => {
    const calls: ((r: FetchResult<User>) => void)[] = []
    const fetcher = withFetcher(() => new Promise<FetchResult<User>>((r) => calls.push(r)))
    const { container } = render(
      <Hooked options={{ fetcher, features: [pagination({ mode: 'server', pageSize: 10 })] }} />,
    )
    expect(live(container)?.textContent).toBe('')
    await act(async () => calls[0]?.({ rows: users.slice(0, 10), rowCount: 25 }))
    expect(live(container)?.textContent).toBe('Page 1 of 3')
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await act(async () => calls[1]?.({ rows: users.slice(10, 20), rowCount: 25 }))
    expect(live(container)?.textContent).toBe('Page 2 of 3')
  })
})
