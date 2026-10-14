// @vitest-environment node
import { describe, expect, it } from 'vitest'
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
