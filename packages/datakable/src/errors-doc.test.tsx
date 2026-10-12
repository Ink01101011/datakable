import { createTable as createCoreTable, defaultFeatures } from '@datakable/core'
import { cleanup, render } from '@testing-library/react'
import { createElement, type FunctionComponent } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { injectedBy } from '../../core/src/fault-injection/injected-by'
import { captureConsole, normalize, PARTS, parseErrorsDoc } from './errors-doc'
import { FIXTURES } from './errors-doc-fixtures'
import {
  buildDiagnostic,
  type DiagnosticCode,
  formatDiagnostic,
  getDiagnosticDefinition,
  listDiagnosticCodes,
  VERSION,
} from './index'

/**
 * `docs/errors.md` (T38, §8.3, §11). The codes come from the real registries: `datakable` loads
 * `@datakable/core` and `@datakable/react`, which register every code they can emit. For each code
 * CI fails without:
 * - a `## DK_*` section whose GitHub anchor is the one the diagnostic's `docs` URL links to, with
 *   the four parts problem / common causes / fix / example;
 * - a fault-injection test (`injected-by.ts`, shared with the core catalog test);
 * - a real example: either a runnable file in `./errors-examples/` (the page's TypeScript block is
 *   that file, which `pnpm typecheck` compiles against the built packages; this test runs it and
 *   the page's output block must be what DataKable printed), or, for codes no snippet can trigger
 *   (a second core copy, a production build, a DataKable bug), a diagnostic built from the details
 *   its fault test asserts (`errors-doc-fixtures.ts`);
 * - a non-empty `where` and `fix` in that real diagnostic.
 *
 * `*.server.ts` examples need a server render (no `document`): `errors-doc.server.test.ts`.
 */

const fs = (await import('node:fs' as string)) as {
  readFileSync(path: string, encoding: 'utf8'): string
  readdirSync(path: string): string[]
}

declare global {
  interface ImportMeta {
    /** The directory of this file (happy-dom replaces the global URL: no `new URL(…, url)`). */
    dirname: string
    glob(pattern: string): Record<string, () => Promise<Record<string, unknown>>>
  }
}

const page = fs.readFileSync(`${import.meta.dirname}/../../../docs/errors.md`, 'utf8')
const sections = parseErrorsDoc(page)
/** The ```text blocks of the page's `## <heading>` section. */
const textBlocks = (heading: string) => {
  const from = page.indexOf(`\n## ${heading}\n`)
  const body = page.slice(from + 1, page.indexOf('\n## ', from + 1))
  return [...body.matchAll(/^```text\n([\s\S]*?)^```$/gm)].map((m) => (m[1] ?? '').trim())
}
const section = (code: string) => sections.find((s) => s.code === code)

/** `packages/core/src/../../react/src/x` → `../packages/react/src/x` (relative to docs/). */
function repoPath(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '..') out.pop()
    else out.push(part)
  }
  return `../${out.join('/')}`
}

const codes = listDiagnosticCodes()
  .filter((c) => !c.startsWith('DK_TEST_'))
  .sort()

const examplesDir = `${import.meta.dirname}/errors-examples`
const exampleFiles = fs.readdirSync(examplesDir).filter((f) => /\.tsx?$/.test(f))
const exampleOf = (code: string) => exampleFiles.find((f) => f.split('.')[0] === code)
const loaders = import.meta.glob('./errors-examples/*.{ts,tsx}')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** Runs an example: imports it (a default-exported component is rendered, then re-rendered). */
async function run(code: string, file: string): Promise<string> {
  const load = loaders[`./errors-examples/${file}`]
  if (!load) throw new Error(`no loader for ${file}`)
  const cap = captureConsole((method, fn) => {
    vi.spyOn(console, method).mockImplementation(fn)
  })
  let mod: Record<string, unknown>
  try {
    mod = await load()
  } catch (e) {
    // Config errors (§8.6) are thrown at creation.
    if (e instanceof Error && (e as { code?: unknown }).code === code) {
      return `${e.name}: ${e.message}`
    }
    throw e
  }
  if (typeof mod.default === 'function') {
    const App = mod.default as FunctionComponent
    const { rerender } = render(createElement(App))
    for (let i = 0; i < 3; i++) rerender(createElement(App))
  }
  await vi.waitFor(
    () => {
      if (!cap.printed().some((p) => p.code === code)) throw new Error(`${code} was not printed`)
    },
    { timeout: 3000 },
  )
  return (cap.printed().find((p) => p.code === code) as { text: string }).text
}

/** A fixture-built diagnostic, printed like the dev console sink does. */
function built(code: string): string {
  const f = FIXTURES[code]
  if (!f) throw new Error(`no fixture for ${code}`)
  const d = buildDiagnostic(code as DiagnosticCode, f.details as never, {
    table: 'table#1',
    ...f.input,
  })
  const { header, body } = formatDiagnostic(d)
  return `${header}\n${body}`
}

describe('docs/errors.md', () => {
  it('has a section for every registered code, and none for unknown codes', () => {
    expect(codes.length).toBeGreaterThan(50)
    expect(codes.filter((c) => !section(c))).toEqual([])
    expect(sections.map((s) => s.code).filter((c) => !codes.includes(c))).toEqual([])
    expect(sections.length).toBe(new Set(sections.map((s) => s.code)).size)
  })

  it('every registered code has a fault-injection test (injected-by.ts), and no stale entry', () => {
    expect(codes.filter((c) => !(c in injectedBy))).toEqual([])
    expect(Object.keys(injectedBy).filter((c) => !codes.includes(c))).toEqual([])
  })

  it('every code has exactly one example: a runnable file or a fixture', () => {
    const both = codes.filter((c) => exampleOf(c) && FIXTURES[c])
    const neither = codes.filter((c) => !exampleOf(c) && !FIXTURES[c])
    expect({ both, neither }).toEqual({ both: [], neither: [] })
    const stale = [
      ...exampleFiles.filter((f) => !codes.includes(f.split('.')[0] as string)),
      ...Object.keys(FIXTURES).filter((c) => !codes.includes(c)),
    ]
    expect(stale).toEqual([])
  })

  it.each(codes)('%s: problem / common causes / fix / example, in that order', (code) => {
    const s = section(code)
    expect(s?.parts).toEqual([...PARTS])
    const at = PARTS.map((p) => s?.body.indexOf(`**${p}.**`))
    expect(at).toEqual([...at].sort((a, b) => (a ?? 0) - (b ?? 0)))
    expect(s?.output, 'output block').toBeTruthy()
    // The level, and a link to the fault-injection test (`injected-by.ts`).
    const level = getDiagnosticDefinition(code)?.level
    expect(s?.body.split('\n').find((l) => l.trim() !== '')).toContain(`\`${level}\``)
    expect(s?.body).toContain(`](${repoPath(`packages/core/src/${injectedBy[code]}`)})`)
  })

  it.each(codes)(
    '%s: the example is real, and its diagnostic links to the section',
    async (code) => {
      const s = section(code)
      const file = exampleOf(code)
      // Server-render examples run in errors-doc.server.test.ts; here only the shared checks.
      const printed =
        file === undefined
          ? built(code)
          : file.includes('.server.')
            ? (s?.output ?? '')
            : await run(code, file)
      if (file === undefined) {
        expect(s?.code_block, 'a fixture example has no code block').toBeUndefined()
      } else {
        const source = fs.readFileSync(`${examplesDir}/${file}`, 'utf8').trim()
        expect(s?.code_block?.source, `the TypeScript block is ${file}`).toBe(source)
        expect(s?.code_block?.lang).toBe(file.endsWith('.tsx') ? 'tsx' : 'ts')
      }
      expect(normalize(s?.output ?? '', VERSION)).toBe(normalize(printed, VERSION))
      // `where` and `fix` are non-empty in the real diagnostic (§8.3).
      expect(printed).toMatch(/^ {2}where {3}\S/m)
      expect(printed).toMatch(/^ {2}fix {5}1\. \S/m)
      // The docs URL the diagnostic built points at this section's anchor.
      const docs = /^ {2}docs {4}(\S+)$/m.exec(printed)?.[1]
      expect(docs).toMatch(/\/docs\/errors\.md#/)
      expect(docs?.slice(docs.indexOf('#') + 1)).toBe(s?.anchor)
      expect(getDiagnosticDefinition(code)?.docs).toBeUndefined()
    },
  )

  it('the console format shown in "Reading a diagnostic" is DK_DUPLICATE_ROW_KEY\'s real output', () => {
    const [shown] = textBlocks('Reading a diagnostic')
    const real = section('DK_DUPLICATE_ROW_KEY')?.output ?? ''
    expect(shown?.replace('[DataKable UsersTable]', '[DataKable table#1]')).toBe(real)
  })

  it('the explain() / explainRow() output shown is what they print', async () => {
    const products = [
      { sku: 'SKU-001', name: 'Desk chair', price: 120 },
      { sku: 'SKU-002', name: 'Desk lamp', price: 40 },
      { sku: 'SKU-042', name: 'Armchair', price: 300 },
      { sku: 'SKU-050', name: 'Bookshelf', price: 150 },
    ]
    const table = createCoreTable({ data: products, rowKey: 'sku', features: defaultFeatures })
    table.setColumnFilter('price', { type: 'range', value: { min: 100 } })
    await table.setSearch('chair')
    const why = table.explainRow('SKU-050')
    expect([why.visible, why.removedBy]).toEqual([false, 'search'])
    const [explain, row] = textBlocks('Debugging tools: `explain()` and `explainRow()`')
    expect(normalize(explain ?? '', VERSION)).toBe(normalize(String(table.explain()), VERSION))
    expect(row).toBe(String(why))
  })
})
