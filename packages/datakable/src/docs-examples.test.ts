// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { driftProblems, fences, type RepoFile } from './docs-check'
import { docsExamples, docsPages } from './docs-files'

/**
 * Docs examples compile (V1, job datakable-docs-v1): every ```ts / ```tsx block of a page under
 * `docs/` (not `docs/superpowers/`) is a file of `./docs-examples/`, which `pnpm typecheck` compiles
 * against the built packages (this package's tsconfig includes `src`). The n-th block of
 * `docs/<section>/<page>.md` is `docs-examples/<section>/<page>/<n>-<slug>.ts(x)`; see
 * `driftProblems` for the rules. New pages and files are picked up with no registration.
 */

/**
 * Pages whose TypeScript blocks another test checks: any `errors.md` (the diagnostics reference in
 * `docs/how-to-fix/`, and the stub at its old address `docs/errors.md`), whose blocks are
 * `./errors-examples/` files run by `errors-doc.test.tsx`. (`docs/how-to-fix/reading-type-errors.md`
 * is checked here: its failing examples carry `// @ts-expect-error`, and
 * `reading-type-errors.test.ts` checks the printed errors.)
 */
const verifiedElsewhere = (page: string) => page.endsWith('/errors.md')

const examples = docsExamples()

describe('docs examples (drift)', () => {
  const pages = docsPages()

  it('finds the docs pages: the hub and the three section indexes', () => {
    for (const page of [
      'docs/README.md',
      'docs/how-to-use/README.md',
      'docs/examples/README.md',
      'docs/how-to-fix/README.md',
    ]) {
      expect(pages.map((p) => p.path)).toContain(page)
    }
    expect(pages.some((p) => p.path.startsWith('docs/superpowers/'))).toBe(false)
  })

  it('every TypeScript block of a docs page is its compiled example file, and every file is shown', () => {
    expect(driftProblems(pages, examples, verifiedElsewhere)).toEqual([])
  })

  it('docs-examples/ holds only TypeScript files', () => {
    expect(examples.filter((e) => !/\.tsx?$/.test(e.path)).map((e) => e.path)).toEqual([])
  })
})

describe('driftProblems (the rules, on fixtures)', () => {
  const page = (text: string): RepoFile => ({ path: 'docs/how-to-use/sorting.md', text })
  const none = () => false
  const md = [
    '# Sorting',
    '',
    '```ts',
    'const a = 1',
    '```',
    '',
    '```tsx',
    'const b = <b />',
    '```',
  ]
  const ok = [
    { path: 'how-to-use/sorting/1-first.ts', text: 'const a = 1\n' },
    { path: 'how-to-use/sorting/2-second.tsx', text: 'const b = <b />\n' },
  ]

  it('accepts blocks that equal their numbered files', () => {
    expect(driftProblems([page(md.join('\n'))], ok, none)).toEqual([])
  })

  it('a block whose file is missing, differs, or has the other extension', () => {
    const changed = [
      { path: 'how-to-use/sorting/1-first.ts', text: 'const a = 2\n' },
      { path: 'how-to-use/sorting/2-second.ts', text: 'const b = <b />\n' },
    ]
    const problems = driftProblems([page(md.join('\n'))], changed, none)
    expect(problems).toHaveLength(2)
    expect(problems[0]).toContain('differs from docs-examples/how-to-use/sorting/1-first.ts')
    expect(problems[1]).toContain('a ```tsx block, but the file is')
    expect(driftProblems([page(md.join('\n'))], [ok[0] as RepoFile], none)).toEqual([
      'docs/how-to-use/sorting.md:7 (block 2): no example file docs-examples/how-to-use/sorting/2-<slug>.tsx',
    ])
  })

  it('order matters: the n-th block is file n', () => {
    const swapped = [md[0], '', ...md.slice(6), '', ...md.slice(2, 5)].join('\n')
    const problems = driftProblems([page(swapped)], ok, none)
    // Each block meets the other's file: wrong extension and different text, twice.
    expect(problems).toHaveLength(4)
    expect(problems.every((p) => p.includes('(block 1)') || p.includes('(block 2)'))).toBe(true)
  })

  it('a file no block shows, a badly named file, and helpers', () => {
    const extra = [
      ...ok,
      { path: 'how-to-use/sorting/3-third.ts', text: 'x' },
      { path: 'how-to-use/sorting/data.ts', text: 'x' },
      { path: 'how-to-use/gone/1-a.ts', text: 'x' },
      { path: 'how-to-use/sorting/_data.ts', text: 'x' },
      { path: 'examples/_shared/users.ts', text: 'x' },
    ]
    expect(driftProblems([page(md.join('\n'))], extra, none)).toEqual([
      'docs-examples/how-to-use/sorting/3-third.ts is not shown: no matching block in docs/how-to-use/sorting.md',
      'docs-examples/how-to-use/sorting/data.ts: name it <n>-<slug>.ts(x), or prefix a helper with _',
      'docs-examples/how-to-use/gone/1-a.ts is not shown: no matching block in docs/how-to-use/gone.md',
    ])
  })

  it('refuses ```typescript and indented ```ts fences, even on skipped pages', () => {
    const text = ['```typescript', 'x', '```', '', '- item', '', '  ```ts', '  y', '  ```'].join(
      '\n',
    )
    expect(driftProblems([page(text)], [], () => true)).toEqual([
      'docs/how-to-use/sorting.md:1: write ```ts / ```tsx, not ```typescript',
      'docs/how-to-use/sorting.md:7: a ```ts block must start at column 0',
    ])
  })

  it('skipped pages and other languages are not checked', () => {
    expect(driftProblems([page(md.join('\n'))], [], () => true)).toEqual([])
    const sh = ['```sh', 'pnpm add datakable', '```', '```text', 'out', '```'].join('\n')
    expect(driftProblems([page(sh)], [], none)).toEqual([])
  })

  it('fences: a block keeps its text, and an unclosed fence runs to the end', () => {
    expect(fences('```ts\n  a\n\n  b\n```\n')[0]?.code).toBe('a\n\n  b')
    expect(fences('x\n```ts\na').map((f) => [f.code, f.line, f.end])).toEqual([['a', 2, 3]])
  })
})
