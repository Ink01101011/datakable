// @vitest-environment node

import { VERSION } from '@datakable/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureConsole, normalize, parseErrorsDoc } from './errors-doc'

/**
 * The `docs/errors.md` examples that need a server render (no `document`): `*.server.tsx` in
 * `./errors-examples/`. The other checks of those sections run in `errors-doc.test.tsx`.
 */

const fs = (await import('node:fs' as string)) as {
  readFileSync(path: URL, encoding: 'utf8'): string
}

declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<Record<string, unknown>>>
  }
}

const sections = parseErrorsDoc(
  fs.readFileSync(new URL('../../../docs/errors.md', import.meta.url), 'utf8'),
)
const loaders = Object.entries(import.meta.glob('./errors-examples/*.server.{ts,tsx}'))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('docs/errors.md server-render examples', () => {
  it('there are some', () => {
    expect(loaders.length).toBeGreaterThan(0)
  })

  it.each(loaders)('%s prints the documented output', async (file, load) => {
    const code = file.slice(file.lastIndexOf('/') + 1).split('.')[0] as string
    const cap = captureConsole((method, fn) => {
      vi.spyOn(console, method).mockImplementation(fn)
    })
    await load()
    await vi.waitFor(() => {
      if (!cap.printed().some((p) => p.code === code)) throw new Error(`${code} was not printed`)
    })
    const printed = (cap.printed().find((p) => p.code === code) as { text: string }).text
    const output = sections.find((s) => s.code === code)?.output
    expect(normalize(output ?? '', VERSION)).toBe(normalize(printed, VERSION))
    expect(printed).toMatch(/phase=ssr$/m)
  })
})
