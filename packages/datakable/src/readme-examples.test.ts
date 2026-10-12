// @vitest-environment node
import { describe, expect, it } from 'vitest'

/**
 * README examples compile (T40, §12): every ```ts / ```tsx block in the READMEs is one file of
 * `./readme-examples/`, which `pnpm typecheck` compiles against the built packages (the imports a
 * consumer writes: `datakable`, `@datakable/core/sorting`, …). This test keeps the two in sync: a
 * README block that is not an example file, or an example no README shows, fails.
 */

// No @types/node here: declare just what is read.
const fs = (await import('node:fs' as string)) as {
  readFileSync(path: URL, encoding: 'utf8'): string
  readdirSync(path: URL): string[]
}

const READMES = [
  'README.md',
  'packages/core/README.md',
  'packages/react/README.md',
  'packages/datakable/README.md',
]
const root = new URL('../../../', import.meta.url)
const examplesDir = new URL('./readme-examples/', import.meta.url)

const BLOCK = /^```(ts|tsx)\n([\s\S]*?)^```$/gm

const blocks = READMES.flatMap((readme) =>
  [...fs.readFileSync(new URL(readme, root), 'utf8').matchAll(BLOCK)].map((m) => ({
    readme,
    code: (m[2] ?? '').trim(),
  })),
)
const examples = fs
  .readdirSync(examplesDir)
  .filter((f) => /\.tsx?$/.test(f))
  .map((file) => ({
    file,
    code: fs.readFileSync(new URL(file, examplesDir), 'utf8').trim(),
  }))

describe('README examples', () => {
  it('the READMEs have examples', () => {
    expect(blocks.length).toBeGreaterThan(0)
    for (const readme of READMES) expect(blocks.some((b) => b.readme === readme)).toBe(true)
  })

  it('every TypeScript block in a README is a compiled example file', () => {
    const missing = blocks
      .filter((b) => !examples.some((e) => e.code === b.code))
      .map((b) => `${b.readme}:\n${b.code.split('\n').slice(0, 3).join('\n')}`)
    expect(missing).toEqual([])
  })

  it('every example file is shown in a README', () => {
    const unused = examples.filter((e) => !blocks.some((b) => b.code === e.code)).map((e) => e.file)
    expect(unused).toEqual([])
  })
})
