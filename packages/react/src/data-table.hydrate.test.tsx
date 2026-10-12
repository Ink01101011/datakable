import { type Diagnostic, type FetchResult, search, sorting } from '@datakable/core'
import { act } from '@testing-library/react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { DataTable } from './data-table'
import { useDataTable } from './use-data-table'

// Hydration across wave 10 (R10): <DataTable />'s deferred Loading (T32 × T33), and time-sliced
// search (T29) never making the hydrated client differ from the server HTML (T32).
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type User = { id: number; name: string }
const users = (n: number): User[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i,
    name: `${['Ada', 'Bob', 'Cara', 'Dan', 'Eve'][i % 5]} ${(i * 7919) % 1000}`,
  }))
const columns = [{ key: 'name', header: 'Name' }] as const

let consoleError: MockInstance
let root: Root | undefined
let container: HTMLElement
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const m of ['warn', 'info', 'log', 'groupCollapsed', 'groupEnd'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {})
  }
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  container.remove()
  vi.restoreAllMocks()
})

const hydrationErrors = () =>
  consoleError.mock.calls.filter((c) => /hydrat|did not match/i.test(c.map(String).join(' ')))

async function ssrThenHydrate(el: React.ReactElement) {
  container.innerHTML = renderToString(el)
  const html = container.innerHTML
  await act(async () => {
    root = hydrateRoot(container, el)
  })
  return html
}

/** A fast clock (every reading +100 ms): every `yield` of a sliced job ends its slice. */
let clock = 0
const fastClock = () =>
  vi.spyOn(performance, 'now').mockImplementation(() => {
    clock += 100
    return clock
  })
/** Lets every pending slice run (setTimeout fallback: one macrotask per slice). */
async function settle(rounds = 200) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  }
}

describe('<DataTable /> hydration: deferred Loading (T32 × T33)', () => {
  it('a fetcher without initialData: Loading on the server, while fetching, then the rows', async () => {
    let resolve: (r: FetchResult<User>) => void = () => {}
    const fetcher = vi.fn(
      () =>
        new Promise<FetchResult<User>>((r) => {
          resolve = r
        }),
    )
    const el = (
      <DataTable<User>
        columns={columns}
        features={[sorting({ mode: 'server' })]}
        fetcher={fetcher}
      />
    )
    const html = await ssrThenHydrate(el)
    expect(html).toContain('data-dk-state="loading"')
    expect(hydrationErrors()).toEqual([])
    // Started after hydration: still Loading (now 'fetching'), never Empty in between.
    expect(fetcher).toHaveBeenCalledTimes(1)
    const rootEl = container.querySelector('[data-datakable]') as HTMLElement
    expect(rootEl.dataset.status).toBe('fetching')
    expect(container.querySelector('[data-dk-state="loading"]')).not.toBeNull()
    expect(container.textContent).not.toContain('No rows')
    await act(async () => resolve({ rows: users(2), rowCount: 2 }))
    expect(container.querySelector('[data-dk-state]')).toBeNull()
    expect(container.textContent).toContain('Ada 0')
  })
})

/** Options are passed loosely: each test combines features differently. */
function Names(props: Record<string, unknown> & { expose?: (t: unknown) => void }) {
  const { expose, ...options } = props
  const t = useDataTable<User>(options as never)
  expose?.(t)
  return (
    <ul data-status={t.rowModel.status}>
      {t.rowModel.rows.map((r) => (
        <li key={r.key}>{r.original.name}</li>
      ))}
    </ul>
  )
}

describe('hydration with time-sliced search (T29 × T32)', () => {
  it('an initial query: the first client row model is not sliced, so it matches the server', async () => {
    fastClock()
    const codes: string[] = []
    const el = (
      <Names
        data={users(30)}
        columns={[{ key: 'name', search: 1 }]}
        features={[search<User>()]}
        initialState={{ search: { input: 'ada', query: 'ada', status: 'idle' } }}
        onDiagnostic={(d: Diagnostic) => codes.push(d.code)}
      />
    )
    const html = await ssrThenHydrate(el)
    expect(html).toContain('data-status="idle"')
    expect(html).toContain('<li>Ada 0</li>')
    expect(html).not.toContain('Bob')
    expect(hydrationErrors()).toEqual([])
    expect(codes).not.toContain('DK_HYDRATION_MISMATCH')
    expect(container.innerHTML).toBe(html)
  })

  it('a query typed after hydration is sliced on the client: pending, then the results', async () => {
    fastClock()
    const codes: string[] = []
    let table:
      | { setSearch(q: string): Promise<unknown>; flushSearch(): Promise<unknown> }
      | undefined
    const el = (
      <Names
        data={users(30)}
        columns={[{ key: 'name', search: 1 }]}
        features={[search<User>({ typing: { commitOn: 'enter' } })]}
        onDiagnostic={(d: Diagnostic) => codes.push(d.code)}
        expose={(t) => {
          table = t as typeof table
        }}
      />
    )
    const html = await ssrThenHydrate(el)
    expect(html).toContain('data-status="idle"')
    expect(container.innerHTML).toBe(html)
    expect(hydrationErrors()).toEqual([])
    expect(codes).not.toContain('DK_HYDRATION_MISMATCH')

    let applied: Promise<unknown> | undefined
    act(() => {
      void table?.setSearch('ada')
      applied = table?.flushSearch()
    })
    // The projection builds in slices: 'pending' over the previous rows.
    expect(container.querySelector('ul')?.dataset.status).toBe('pending')
    expect(container.textContent).toContain('Bob')
    await settle()
    expect(container.querySelector('ul')?.dataset.status).toBe('idle')
    expect(container.textContent).toContain('Ada 0')
    expect(container.textContent).not.toContain('Bob')
    await expect(applied).resolves.toEqual({ status: 'applied' })
  })
})
