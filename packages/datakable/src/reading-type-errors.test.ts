// @vitest-environment node
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'
import { fences } from './docs-check'
import { readRepo } from './docs-files'

/**
 * `docs/how-to-fix/reading-type-errors.md` (D3, job datakable-docs-v1): its TypeScript blocks are
 * the compiled files of `./docs-examples/how-to-fix/reading-type-errors/` (drift test), and each
 * failing example carries `// @ts-expect-error` on the failing line (`pnpm typecheck` proves it
 * errors). Here those files are compiled in memory with the directives blanked out, against the
 * package sources, and each ```text block of the page — the n-th one belongs to the n-th failing
 * example — must be what TypeScript prints there. `…` in a block stands for text left out (the
 * long `Path<User>` union, whose member order is a TypeScript implementation detail): the parts
 * around it must appear in order. The core pins the same messages in
 * `packages/core/src/column/type-errors.test.ts`.
 */

const PAGE = 'docs/how-to-fix/reading-type-errors.md'
const pkg = decodeURIComponent(new URL('../', import.meta.url).pathname)
const dir = `${pkg}src/docs-examples/how-to-fix/reading-type-errors/`
const DIRECTIVE = '@ts-expect-error'

interface Failing {
  file: string
  /** `error TS<code>: <message>` for each error on the line under the directive. */
  errors: string[]
}

let failing: Failing[]
let stray: string[]

beforeAll(() => {
  const config = ts.getParsedCommandLineOfConfigFile(
    `${pkg}tsconfig.json`,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => {
        throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'))
      },
    },
  )
  if (!config) throw new Error('cannot read packages/datakable/tsconfig.json')
  // Resolve the packages to their sources, so no build is needed.
  const options: ts.CompilerOptions = {
    ...config.options,
    paths: {
      datakable: [`${pkg}src/index.ts`],
      '@datakable/core': [`${pkg}../core/src/index.ts`],
      '@datakable/react': [`${pkg}../react/src/index.ts`],
    },
  }
  const files = (ts.sys.readDirectory(dir, ['.ts', '.tsx']) ?? []).sort()
  const blanked = new Map<string, string>()
  for (const file of files) {
    const text = ts.sys.readFile(file) ?? ''
    blanked.set(file, text.replaceAll(DIRECTIVE, ' '.repeat(DIRECTIVE.length)))
  }
  const read = (file: string) => blanked.get(file) ?? ts.sys.readFile(file)
  const service = ts.createLanguageService({
    getCompilationSettings: () => options,
    getScriptFileNames: () => files,
    getScriptVersion: () => '1',
    getScriptSnapshot: (file) => {
      const text = read(file)
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
    },
    getCurrentDirectory: () => pkg,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: (file) => blanked.has(file) || ts.sys.fileExists(file),
    readFile: read,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  })
  failing = []
  stray = []
  for (const file of files) {
    const original = (ts.sys.readFile(file) ?? '').split('\n')
    const marked = new Set<number>()
    original.forEach((line, i) => {
      if (line.includes(DIRECTIVE)) marked.add(i + 1)
    })
    const source = service.getProgram()?.getSourceFile(file)
    const byLine = new Map<number, string[]>()
    for (const d of service.getSemanticDiagnostics(file)) {
      const line = source?.getLineAndCharacterOfPosition(d.start ?? 0).line ?? -1
      const text = `error TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`
      if (marked.has(line)) byLine.set(line, [...(byLine.get(line) ?? []), text])
      else stray.push(`${file.slice(dir.length)}:${line + 1}: ${text}`)
    }
    for (const line of marked) {
      failing.push({ file: file.slice(dir.length), errors: byLine.get(line) ?? [] })
    }
  }
})

/** The parts of `shown` around each `…` appear in `real`, in order. */
function shows(real: string, shown: string): boolean {
  let at = 0
  for (const part of shown.split('…')) {
    const i = real.indexOf(part, at)
    if (i < 0) return false
    at = i + part.length
  }
  return true
}

describe(PAGE, () => {
  it('the examples have no errors other than the marked ones', () => {
    expect(stray).toEqual([])
  })

  it('each failing example has exactly one error on its marked line', () => {
    expect(failing.length).toBeGreaterThanOrEqual(6)
    expect(failing.filter((f) => f.errors.length !== 1).map((f) => f.file)).toEqual([])
  })

  it('the n-th text block is what TypeScript prints for the n-th failing example', () => {
    const blocks = fences(readRepo(PAGE)).filter((f) => f.lang === 'text')
    expect(blocks.map((b) => b.code).length).toBe(failing.length)
    const wrong = failing
      .map((f, i) => ({ file: f.file, real: f.errors[0] ?? '', shown: blocks[i]?.code ?? '' }))
      .filter((x) => !shows(x.real, x.shown))
    expect(wrong).toEqual([])
  })
})
