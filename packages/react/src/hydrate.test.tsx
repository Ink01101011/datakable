import { type Diagnostic, type FetchResult, search, sorting } from '@datakable/core'
import { withSearchFn } from '@datakable/core/search-async'
import { withFetcher } from '@datakable/core/server'
import { act } from '@testing-library/react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { useDataTable } from './use-data-table'

type User = { id: number; name: string; age: number }
const users: User[] = [
  { id: 1, name: 'Ada', age: 36 },
  { id: 2, name: 'Grace', age: 45 },
  { id: 3, name: 'Linus', age: 28 },
]

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

/** React hydration errors (text / attribute mismatch, recoverable errors). */
const hydrationErrors = () =>
  consoleError.mock.calls.filter((c) => /hydrat|did not match/i.test(c.map(String).join(' ')))

/** Set in a test to change the table while the client renders (a render-phase update). */
let duringClientRender: ((t: { toggleSort(id: string): void }) => void) | undefined

/** Options are passed loosely: each test combines features differently. */
function Names(props: Record<string, unknown>) {
  const t = useDataTable<User>(props as never)
  duringClientRender?.(t as never)
  duringClientRender = undefined
  return (
    <ul data-status={t.rowModel.status}>
      {t.rowModel.rows.map((r) => (
        <li key={r.key}>{r.original.name}</li>
      ))}
    </ul>
  )
}

/** Server HTML of `el`, then hydrated on the client with `el` again. */
async function ssrThenHydrate(el: React.ReactElement) {
  container.innerHTML = renderToString(el)
  const html = container.innerHTML
  await act(async () => {
    root = hydrateRoot(container, el)
  })
  return html
}

describe('hydration (§7.2)', () => {
  it('with initialData: hydrates the server HTML and does not re-fetch', async () => {
    const fetcher = vi.fn(() => ({ rows: [] as User[], rowCount: 0 }))
    const codes: string[] = []
    const el = (
      <Names
        features={[sorting({ mode: 'server' })]}
        fetcher={withFetcher(fetcher)}
        initialData={users}
        onDiagnostic={(d: Diagnostic) => codes.push(d.code)}
      />
    )
    const html = await ssrThenHydrate(el)
    expect(html).toContain('<li>Ada</li><li>Grace</li><li>Linus</li>')
    await act(async () => {})
    expect(fetcher).not.toHaveBeenCalled()
    expect(container.innerHTML).toBe(html)
    expect(hydrationErrors()).toEqual([])
    expect(codes).not.toContain('DK_HYDRATION_MISMATCH')
  })

  it('without initialData: hydrates pending, then fetches once on the client', async () => {
    let resolve: (r: FetchResult<User>) => void = () => {}
    const fetcher = vi.fn(
      () =>
        new Promise<FetchResult<User>>((r) => {
          resolve = r
        }),
    )
    const el = <Names features={[sorting({ mode: 'server' })]} fetcher={withFetcher(fetcher)} />
    const html = await ssrThenHydrate(el)
    expect(html).toBe('<ul data-status="pending"></ul>')
    expect(hydrationErrors()).toEqual([])
    // The server render did not fetch; the client fetches after hydrating.
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(container.innerHTML).toBe('<ul data-status="fetching"></ul>')
    await act(async () => resolve({ rows: users.slice(0, 1), rowCount: 1 }))
    expect(container.innerHTML).toBe('<ul data-status="idle"><li>Ada</li></ul>')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('a deferred searchFn query searches after hydration', async () => {
    const searchFn = vi.fn(({ rows }: { rows: readonly User[] }) =>
      Promise.resolve(rows.filter((u) => u.name === 'Ada')),
    )
    const el = (
      <Names
        data={users}
        features={[search<User>({ searchFn: withSearchFn(searchFn) })]}
        initialState={{ search: { input: 'ada', query: 'ada', status: 'idle' } }}
      />
    )
    const html = await ssrThenHydrate(el)
    expect(html).toContain('data-status="pending"')
    await act(async () => {})
    expect(hydrationErrors()).toEqual([])
    expect(searchFn).toHaveBeenCalledTimes(1)
    expect(container.innerHTML).toBe('<ul data-status="idle"><li>Ada</li></ul>')
  })

  it('DK_HYDRATION_MISMATCH: the table changed before the hydration commit (names the slice)', async () => {
    const diags: Diagnostic[] = []
    const el = (
      <Names data={users} features={[sorting()]} onDiagnostic={(d: Diagnostic) => diags.push(d)} />
    )
    container.innerHTML = renderToString(el)
    duringClientRender = (t) => t.toggleSort('age')
    await act(async () => {
      root = hydrateRoot(container, el)
    })
    // React hydrated with the server snapshot (no React mismatch), then re-rendered.
    expect(hydrationErrors()).toEqual([])
    expect(container.innerHTML).toContain('<li>Linus</li><li>Ada</li><li>Grace</li>')
    const d = diags.filter((x) => x.code === 'DK_HYDRATION_MISMATCH')
    expect(d).toHaveLength(1)
    expect(d[0]?.level).toBe('warn')
    expect(d[0]?.details).toEqual({ slices: ['sorting'] })
    expect(d[0]?.where).toEqual({ kind: 'operation', op: 'hydrate', slot: 'sorting' })
    expect(d[0]?.context.trigger).toBe('hydrate')
    expect(d[0]?.context.phase).toBe('hydrate')
    expect(d[0]?.fix.length).toBeGreaterThan(0)
  })

  it('a clean hydration reports nothing, and later updates are not mismatches', async () => {
    const codes: string[] = []
    let api: { toggleSort(id: string): void } | undefined
    function C() {
      const t = useDataTable<User>({
        data: users,
        features: [sorting()],
        onDiagnostic: (d: Diagnostic) => codes.push(d.code),
      } as never) as unknown as { toggleSort(id: string): void }
      api = t
      return null
    }
    container.innerHTML = renderToString(<C />)
    await act(async () => {
      root = hydrateRoot(container, <C />)
    })
    act(() => api?.toggleSort('age'))
    expect(codes).not.toContain('DK_HYDRATION_MISMATCH')
    expect(codes).not.toContain('DK_SSR_ASYNC_DEFERRED')
  })
})
