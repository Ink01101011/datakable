// @vitest-environment node
import {
  type Diagnostic,
  type FetchParams,
  type FetchResult,
  search,
  sorting,
} from '@datakable/core'
import { withFetcher } from '@datakable/core/server'
import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDataTable } from './use-data-table'

type User = { id: number; name: string; age: number }
const users: User[] = [
  { id: 1, name: 'Ada', age: 36 },
  { id: 2, name: 'Grace', age: 45 },
  { id: 3, name: 'Linus', age: 28 },
]

beforeEach(() => {
  vi.useFakeTimers()
  for (const m of ['warn', 'error', 'info', 'log', 'groupCollapsed', 'groupEnd'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {})
  }
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Options are passed loosely: each test combines features differently. */
function Names(props: Record<string, unknown>) {
  const t = useDataTable<User>(props as never)
  return (
    <ul data-status={t.rowModel.status}>
      {t.rowModel.rows.map((r) => (
        <li key={r.key}>{r.original.name}</li>
      ))}
    </ul>
  )
}

describe('SSR: renderToString (§7.2)', () => {
  it('a fetcher does not run on the server: no request, no timer, status pending', async () => {
    const fetcher = vi.fn((_p: FetchParams) => Promise.resolve<FetchResult<User>>({ rows: users }))
    const diags: Diagnostic[] = []
    const html = renderToString(
      <Names
        features={[sorting({ mode: 'server' })]}
        fetcher={withFetcher(fetcher)}
        onDiagnostic={(d: Diagnostic) => diags.push(d)}
      />,
    )
    expect(html).toBe('<ul data-status="pending"></ul>')
    expect(fetcher).not.toHaveBeenCalled()
    // Nothing pending after the render (the asyncControl timeout timer never started).
    expect(vi.getTimerCount()).toBe(0)
    await vi.runAllTimersAsync()
    expect(fetcher).not.toHaveBeenCalled()
    const d = diags.filter((x) => x.code === 'DK_SSR_ASYNC_DEFERRED')
    expect(d).toHaveLength(1)
    expect(d[0]?.context.phase).toBe('ssr')
  })

  it('initialData renders its rows on the server, without a request', () => {
    const fetcher = vi.fn(() => ({ rows: [] as User[] }))
    const diags: string[] = []
    const html = renderToString(
      <Names
        features={[sorting({ mode: 'server' })]}
        fetcher={withFetcher(fetcher)}
        initialData={users}
        onDiagnostic={(d: Diagnostic) => diags.push(d.code)}
      />,
    )
    expect(html).toBe('<ul data-status="idle"><li>Ada</li><li>Grace</li><li>Linus</li></ul>')
    expect(fetcher).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(diags).not.toContain('DK_SSR_ASYNC_DEFERRED')
  })

  it('an async searchFn for an initialState query is deferred: rows unsearched, pending', () => {
    const searchFn = vi.fn(() => Promise.resolve([] as User[]))
    const html = renderToString(
      <Names
        data={users}
        features={[search<User>({ searchFn })]}
        initialState={{ search: { input: 'ada', query: 'ada', status: 'idle' } }}
      />,
    )
    expect(html).toBe('<ul data-status="pending"><li>Ada</li><li>Grace</li><li>Linus</li></ul>')
    expect(searchFn).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('client-mode features run during the server render (?q= pre-filtered, sorted)', () => {
    const q = new URLSearchParams('?q=grace').get('q') ?? ''
    const html = renderToString(
      <Names
        data={users}
        columns={[{ key: 'name' }]}
        features={[search<User>(), sorting()]}
        initialState={{
          search: { input: q, query: q, status: 'idle' },
          sorting: { by: [{ id: 'age', desc: false }] },
        }}
      />,
    )
    expect(html).toBe('<ul data-status="idle"><li>Grace</li></ul>')
  })

  it('StrictMode on the server: no request, no timer', () => {
    const fetcher = vi.fn(() => ({ rows: users }))
    renderToString(
      <StrictMode>
        <Names features={[sorting({ mode: 'server' })]} fetcher={withFetcher(fetcher)} />
      </StrictMode>,
    )
    expect(fetcher).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
