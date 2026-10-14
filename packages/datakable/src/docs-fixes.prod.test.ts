// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { fences } from './docs-check'
import { readRepo } from './docs-files'
import { createTable, type Diagnostic } from './index'

/**
 * Docs fixes of the PVT issues (job datakable-issues-14-63, unit DOCS) that need a production build
 * of core (`DEV` false, as `how-to-fix.prod.test.ts` does). The development-mode ones are in
 * `docs-fixes.test.tsx`.
 */
vi.mock('../../core/src/diagnostics/env', () => ({ DEV: false }))

const PAGE = 'docs/how-to-fix/diagnostics-without-text-in-production.md'
const ex = './docs-examples/how-to-fix/diagnostics-without-text-in-production'

describe('#48: messages in Nuxt / Nitro (a side-effect-only import is dropped)', () => {
  it('the page installs the messages with a call, which a bundler cannot drop', async () => {
    const plugin = fences(readRepo(PAGE)).find((f) => f.code.includes('defineNuxtPlugin'))
    expect(plugin?.code).toContain('installMessages(...allMessages)')
    expect(plugin?.code).not.toMatch(/^import '@datakable\/core\/messages'/m)

    const duplicate = () => {
      const seen: Diagnostic[] = []
      createTable({
        data: [{ id: 1 }, { id: 1 }],
        rowKey: 'id',
        onDiagnostic: (d) => void seen.push(d),
      }).getRowModel()
      return seen.find((d) => d.code === 'DK_DUPLICATE_ROW_KEY')
    }
    expect(duplicate()?.problem).toBe('')
    const registered: (() => void)[] = []
    vi.stubGlobal('defineNuxtPlugin', (setup: () => void) => registered.push(setup))
    await import(`${ex}/5-nuxt-plugin`)
    expect(registered).toHaveLength(1)
    expect(duplicate()?.problem).toMatch(/rowKey "id" is not unique/)
    vi.unstubAllGlobals()
  })
})
