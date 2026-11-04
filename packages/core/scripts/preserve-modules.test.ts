import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { afterAll, describe, expect, it } from 'vitest'
import { inlineDev, loadWithoutProcess, preserveModules } from './preserve-modules.mjs'

const dirs: string[] = []
const scratch = (name: string) => {
  const dir = join(mkdtempSync(join(tmpdir(), 'dk-build-')), name)
  mkdirSync(dir, { recursive: true })
  dirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

describe('preserve-modules: DEV inlining on a CRLF checkout (#81)', () => {
  const lf = "import { DEV } from './diagnostics/env'\nexport const x = DEV ? 1 : 2\n"
  const crlf = lf.replaceAll('\n', '\r\n')

  it('rewrites the DEV import of an LF source', () => {
    expect(inlineDev(lf)).toBe(
      "import './diagnostics/process-guard'\n" +
        'export const x = (process.env.NODE_ENV !== "production") ? 1 : 2\n',
    )
  })

  it('rewrites the DEV import of a CRLF source and keeps its line ending', () => {
    expect(inlineDev(crlf)).toBe(
      "import './diagnostics/process-guard'\r\n" +
        'export const x = (process.env.NODE_ENV !== "production") ? 1 : 2\r\n',
    )
  })

  it('leaves a module without the DEV import alone', () => {
    expect(inlineDev('export const DEVICE = 1\r\n')).toBeUndefined()
  })

  it('the esbuild plugin emits no diagnostics/env import from a CRLF source', async () => {
    const dir = scratch('crlf')
    mkdirSync(join(dir, 'src/diagnostics'), { recursive: true })
    writeFileSync(join(dir, 'src/diagnostics/env.ts'), 'export const DEV = true\r\n')
    writeFileSync(join(dir, 'src/diagnostics/process-guard.ts'), 'export {}\r\n')
    writeFileSync(join(dir, 'src/a.ts'), crlf)
    const out = await build({
      entryPoints: [join(dir, 'src/a.ts')],
      bundle: true,
      format: 'esm',
      // As tsup: platform node leaves `process.env.NODE_ENV` to the consumer's bundler.
      platform: 'node',
      write: false,
      logLevel: 'silent',
      plugins: [preserveModules],
    })
    const code = out.outputFiles[0].text
    expect(code).toContain('./diagnostics/process-guard.js')
    expect(code).toContain('process.env.NODE_ENV !== "production"')
    expect(code).not.toMatch(/diagnostics\/env/)
  })
})

describe('postbuild: loading dist from a path with a space or non-ASCII name (#82)', () => {
  it.each([
    ['index.js', 'export default 1\n'],
    ['index.cjs', 'module.exports = 1\n'],
  ])('%s loads without process', (file, source) => {
    const dir = scratch('with space é')
    writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n')
    writeFileSync(join(dir, file), source)
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', loadWithoutProcess(pathToFileURL(join(dir, file)))],
      { encoding: 'utf8' },
    )
    expect(out).toBe('loaded')
  })
})
