// @vitest-environment node
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import UsersPage from './nextjs-ssr/2-page'

/**
 * `docs/examples/nextjs-ssr.md` (D2), server side: the page (a server component) fetches the first
 * page and the client component renders its rows into the HTML. The client side (no refetch on
 * hydration, later pages from the route handler) is in `_recipes.test.tsx`.
 */

vi.mock('datakable', () => import('../../index'))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('nextjs-ssr.md (server side)', () => {
  it('fetches the requested page while rendering and puts its rows in the HTML', async () => {
    const api = vi.fn(
      async (_url: unknown, _init?: unknown) =>
        new Response(
          JSON.stringify({
            rows: [
              { id: 21, name: 'Ada Lovelace', email: 'ada@example.com' },
              { id: 22, name: 'Grace Hopper', email: 'grace@example.com' },
            ],
            rowCount: 41,
          }),
        ),
    )
    vi.stubGlobal('fetch', api)
    const element = await UsersPage({ searchParams: Promise.resolve({ page: '2' }) })
    const html = renderToString(element)

    expect(api).toHaveBeenCalledTimes(1)
    expect(api.mock.calls[0]?.[0]).toBe('https://api.example.com/users?page=1&size=20')
    expect(api.mock.calls[0]?.[1]).toEqual({ cache: 'no-store' })
    expect(html).toContain('Ada Lovelace')
    expect(html).toContain('Grace Hopper')
    expect(html).not.toMatch(/data-dk-state="loading"/)
    expect(html).toMatch(/data-status="idle"/)
  })

  it('a missing or bad ?page= is the first page', async () => {
    const api = vi.fn(async (_url: unknown) => new Response(JSON.stringify({ rows: [] })))
    vi.stubGlobal('fetch', api)
    await UsersPage({ searchParams: Promise.resolve({}) })
    await UsersPage({ searchParams: Promise.resolve({ page: 'abc' }) })
    expect(api.mock.calls.map((c) => c[0])).toEqual([
      'https://api.example.com/users?page=0&size=20',
      'https://api.example.com/users?page=0&size=20',
    ])
  })
})
