// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { fences } from './docs-check'
import { readRepo } from './docs-files'

/**
 * Docs fixes of the PVT issues (job datakable-issues-14-63, unit DOCS). Each test pins what the
 * corrected page says against what the code does: the page's examples are compiled by
 * `docs-examples.test.ts` + `pnpm typecheck`, and these tests run them (or the behaviour the prose
 * describes) and check that the wrong statement is gone.
 */

const page = (path: string) => readRepo(path)
/** A page's prose: the fenced blocks removed, line breaks folded to spaces. */
const prose = (path: string) => {
  const text = page(path)
  const lines = text.split('\n')
  for (const f of fences(text)) lines.fill('', f.line - 1, f.end)
  return lines.join(' ').replace(/\s+/g, ' ')
}

describe('#15: datakable/messages in the Next.js app router', () => {
  const PAGE = 'docs/how-to-fix/diagnostics-without-text-in-production.md'

  it('does not name layout.tsx as an app entry; imports from a "use client" module instead', async () => {
    const blocks = fences(page(PAGE)).filter((f) => f.lang === 'ts' || f.lang === 'tsx')
    // The generic "app entry" block named app/layout.tsx, a server component (#15).
    const entry = blocks.find((b) => b.code.includes('In the app entry'))
    expect(entry?.code).not.toContain('layout.tsx')
    const client = blocks.find((b) => b.code.startsWith("'use client'"))
    expect(client?.code).toContain("import 'datakable/messages'")
    expect(prose(PAGE)).toMatch(/layout\.tsx` is a server component/)
    // The client module renders nothing; the root layout renders it once.
    const { DatakableMessages } = await import(
      './docs-examples/how-to-fix/diagnostics-without-text-in-production/3-datakable-messages'
    )
    expect(DatakableMessages()).toBe(null)
  })
})

describe('#17: the app-router pages await nothing outside <Suspense> (Next 16 cacheComponents)', () => {
  it('ssr.md: the page renders a Suspense boundary and loads inside it', async () => {
    const { Suspense } = await import('react')
    const { default: Page } = await import('./docs-examples/how-to-use/ssr/3-page')
    const element = Page() as unknown as { type: unknown }
    expect(element).not.toBeInstanceOf(Promise)
    expect(element.type).toBe(Suspense)
  })
})

describe('#31: server mode — filteredCount / totalCount count the loaded page', () => {
  it('server-mode.md: the counts are the page; the total is kept from the fetcher result', async () => {
    const logged: unknown[][] = []
    const log = vi.spyOn(console, 'log').mockImplementation((...a) => void logged.push(a))
    vi.stubGlobal('fetchOrders', async ({ pageIndex = 0 }: { pageIndex?: number }) => ({
      rows: Array.from({ length: 20 }, (_, i) => ({ id: String(pageIndex * 20 + i), total: i })),
      rowCount: 5000,
    }))
    await import('./docs-examples/how-to-use/server-mode/6-counting')
    await vi.waitFor(() => expect(logged).toHaveLength(2))
    expect(logged).toEqual([
      [20, 20, 20],
      [5000, 250],
    ])
    log.mockRestore()
    vi.unstubAllGlobals()
    expect(prose('docs/how-to-use/core-concepts.md')).toMatch(
      /`filteredCount` \| `number` \| Rows left after filter and search, before pagination\. In server mode/,
    )
  })
})

describe('#47: code that is not bundled reads NODE_ENV when it runs', () => {
  it('core reads process.env.NODE_ENV at load time, so a server must set it', async () => {
    const load = async (env: string | undefined) => {
      vi.resetModules()
      vi.stubEnv('NODE_ENV', env)
      try {
        return (await import('../../core/src/diagnostics/env')).DEV
      } finally {
        vi.unstubAllEnvs()
      }
    }
    expect(await load(undefined)).toBe(true) // e.g. `node .output/server/index.mjs`
    expect(await load('production')).toBe(false)
    const text = prose('docs/how-to-use/getting-started.md')
    expect(text).not.toContain('Node needs nothing')
    expect(page('docs/how-to-use/getting-started.md')).toContain(
      'NODE_ENV=production node .output/server/index.mjs',
    )
  })
})

describe('#49: setOptions({ state }) replaces the whole state option', () => {
  it('state.md: feeding back every controlled slice keeps them all controlled', async () => {
    const users = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `n${30 - i}`, age: i }))
    vi.stubGlobal('users', users)
    vi.stubGlobal('writeToUrl', () => {})
    // The example toggles a sort and moves to the next page.
    const { table } = await import('./docs-examples/how-to-use/state/4-controlled-several')
    vi.unstubAllGlobals()
    // Both slices stay controlled: the table asked, the app fed back, the two agree.
    const owned = table.getOptions().state
    expect(Object.keys(owned ?? {}).sort()).toEqual(['pagination', 'sorting'])
    expect(owned?.pagination?.pageIndex).toBe(1)
    expect(table.getState().pagination).toBe(owned?.pagination)
    expect(table.getState().sorting).toBe(owned?.sorting)
    expect(table.getState().sorting.by).toEqual([{ id: 'name', desc: false }])
    expect(prose('docs/how-to-use/core-concepts.md')).toMatch(
      /`setOptions\(partial\)` merges new options into the current ones, one level deep: `state` is replaced as a whole/,
    )
  })

  it('a partial state releases the slices it leaves out (the documented pitfall)', async () => {
    const { createTable, pagination, sorting } = await import('./index')
    const data = Array.from({ length: 30 }, (_, i) => ({ id: i + 1 }))
    const table = createTable({
      data,
      rowKey: 'id',
      features: [sorting(), pagination({ pageSize: 5 })],
      state: { sorting: { by: [] }, pagination: { pageIndex: 0, pageSize: 5 } },
      onStateChange: () => {},
    })
    table.setOptions({ state: { sorting: { by: [] } } })
    table.nextPage() // pagination is no longer controlled: the table moves on its own
    expect(table.getState().pagination.pageIndex).toBe(1)
  })
})

describe('#50: a feature\'s option is reported at feature "<name>", the option in details.path', () => {
  it('matches what errors.md and diagnostics.md say', async () => {
    const { createTable, sorting } = await import('./index')
    const seen: { code: string; where: unknown; details?: unknown }[] = []
    const t = createTable({
      data: [
        { id: 1, s: 'x' },
        { id: 2, s: 'y' },
      ],
      rowKey: 'id',
      features: [sorting({ algorithm: 'radix' })],
      onDiagnostic: (d) => void seen.push(d),
    })
    t.toggleSort('s')
    t.getRowModel()
    const d = seen.find((x) => x.code === 'DK_OPTION_NO_EFFECT')
    expect(d?.where).toEqual({ kind: 'feature', name: 'sorting' })
    expect((d?.details as { path?: string } | undefined)?.path).toBe('algorithm')

    const errors = prose('docs/how-to-fix/errors.md')
    const guide = prose('docs/how-to-use/diagnostics.md')
    for (const text of [errors, guide]) expect(text).not.toContain('options.sorting.algorithm')
    expect(errors).toContain('`sorting({ algorithm })` is reported at `feature "sorting"`')
    expect(guide).toMatch(
      /`'feature'` \| `name` \| `feature "sorting"`; also an option of the feature/,
    )
  })
})
