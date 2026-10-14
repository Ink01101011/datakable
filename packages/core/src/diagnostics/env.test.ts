import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

// No @types/node here: declare just what is used (as feature/minified-bundle.test.ts).
const vm = (await import('node:vm' as string)) as {
  runInNewContext(code: string, context: Record<string, unknown>): unknown
}

const core = decodeURIComponent(new URL('../..', import.meta.url).pathname)

/**
 * Core's source as one script, every module kept as a page without a bundler (CDN, import map)
 * loads it: `ignoreAnnotations` keeps modules the source tree does not mark as side effects (the
 * package's `sideEffects` lists the built process-guard, not its source).
 */
async function bundle(define?: Record<string, string>): Promise<string> {
  const result = await build({
    stdin: {
      contents:
        "import { createTable } from './src/index.ts'\nglobalThis.createTable = createTable",
      resolveDir: core,
      loader: 'ts',
    },
    bundle: true,
    minify: define !== undefined,
    format: 'iife',
    platform: 'neutral',
    ignoreAnnotations: true,
    ...(define ? { define } : {}),
    write: false,
    logLevel: 'silent',
  })
  return result.outputFiles[0]?.text ?? ''
}

/** The error the script throws at load in a realm with the given globals (no `process` by default). */
function load(code: string, globals: Record<string, unknown> = {}): string | undefined {
  try {
    vm.runInNewContext(code, { console, ...globals })
  } catch (e) {
    return String(e)
  }
  return undefined
}

describe('process.env.NODE_ENV not replaced (#36)', () => {
  it('without `process`, the import throws a DataKable error pointing to the fix', async () => {
    const error = load(await bundle())
    expect(error).toMatch(/^ReferenceError: \[DataKable\] process is not defined/)
    expect(error).toContain('process.env.NODE_ENV')
    expect(error).toContain('docs/how-to-fix/process-is-not-defined.md')
  }, 30_000)

  it('with `process` defined before load, it loads', async () => {
    const code = await bundle()
    expect(load(code, { process: { env: { NODE_ENV: 'production' } } })).toBeUndefined()
    expect(load(code, { process: { env: {} } })).toBeUndefined()
  }, 30_000)

  it('costs nothing once replaced: a production bundle drops the check', async () => {
    const code = await bundle({ 'process.env.NODE_ENV': '"production"' })
    expect(code).not.toContain('process-is-not-defined')
    expect(load(code)).toBeUndefined()
  }, 30_000)
})
