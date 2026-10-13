import { build } from 'esbuild'
import { afterAll, describe, expect, it } from 'vitest'

// No @types/node here: declare just what is used (as docs-files.ts).
const { execFileSync } = (await import('node:child_process' as string)) as {
  execFileSync(file: string, args: string[], options: { encoding: 'utf8'; stdio: 'pipe' }): string
}
const fs = (await import('node:fs' as string)) as {
  mkdtempSync(prefix: string): string
  rmSync(path: string, options: { recursive: true; force: true }): void
  writeFileSync(path: string, data: Uint8Array): void
}
const { tmpdir } = (await import('node:os' as string)) as { tmpdir(): string }
const { execPath } = (globalThis as unknown as { process: { execPath: string } }).process

/**
 * Issue #5: `esbuild --bundle --minify` (the documented production command) inlines the identity
 * `defineFeature` at every call site, then drops `feature/define` — side-effect free by the
 * package's `sideEffects` — with the module-level side effect that installed the feature runtime.
 * Every table with features threw. This bundles the source exactly that way and RUNS it.
 */
const core = decodeURIComponent(new URL('../..', import.meta.url).pathname)
const dir = fs.mkdtempSync(`${tmpdir()}/dk-minified-`)
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

async function run(contents: string): Promise<string> {
  const result = await build({
    stdin: { contents, resolveDir: core, loader: 'ts' },
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'node',
    define: { 'process.env.NODE_ENV': '"production"' },
    write: false,
    logLevel: 'silent',
  })
  const [output] = result.outputFiles
  if (!output) throw new Error('esbuild produced no output')
  const file = `${dir}/${Math.random().toString(36).slice(2)}.mjs`
  fs.writeFileSync(file, output.contents)
  try {
    return execFileSync(execPath, [file], { encoding: 'utf8', stdio: 'pipe' }).trim()
  } catch (error) {
    // Node echoes the (one-line, minified) source above the error: keep only the error line.
    const stderr = String((error as { stderr?: unknown }).stderr)
    return stderr.split('\n').find((line) => /^\w*Error\b/.test(line)) ?? stderr.slice(-500)
  }
}

describe('esbuild --minify bundle (issue #5)', () => {
  it('built-in features run: sorting sorts', async () => {
    const out = await run(`
      import { createTable, sorting } from './src/index.ts'
      const t = createTable({ data: [{ id: 2, n: 'b' }, { id: 1, n: 'a' }], rowKey: 'id', features: [sorting()] })
      t.toggleSort('n')
      console.log(t.getRowModel().rows.map((r) => r.original.id).join(','))
    `)
    expect(out).toBe('1,2')
  }, 30_000)

  it('a custom defineFeature feature runs', async () => {
    const out = await run(`
      import { createTable, defineFeature } from './src/index.ts'
      const odd = defineFeature({
        name: 'odd', stage: 'filter', initialState: () => 0, createApi: () => ({}),
        rowModel: (indices) => indices.filter((i) => i % 2 === 0),
      })
      const t = createTable({ data: [{ id: 1 }, { id: 2 }, { id: 3 }], rowKey: 'id', features: [odd] })
      console.log(t.getRowModel().rows.map((r) => r.original.id).join(','))
    `)
    expect(out).toBe('1,3')
  }, 30_000)
})
