// Bundle sizes against §9.3 (T37). The one committed size method (R10) — see `size-limits.mjs`.
// Run after `pnpm build`.
//   pnpm size          prints size vs spec budget vs ratchet for every entry
//   pnpm check:size    the same, and exits 1 when an entry grew past its ratchet
// Both also RUN every measured bundle (the entry's `smoke`) and exit 1 when one fails (#5).
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import entries from './size-limits.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
// esbuild 0.27.7 is pinned in @datakable/core's devDependencies (the version of the method).
const esbuild = createRequire(join(root, 'packages/core/package.json'))('esbuild')
const EXTERNAL = ['ex-search', 'exsorted', 'exsorted/*', 'kk-debounce', 'kk-debounce/*']
const EXTERNAL_REACT = ['react', 'react/*', 'react-dom', 'react-dom/*']

/** gzip -9 size (bytes) of `entry`'s production bundle. */
export async function measure(entry) {
  const dir = join(root, 'packages', entry.pkg)
  const result = await esbuild.build({
    stdin: {
      contents: `export { ${entry.import.join(', ')} } from './dist/index.js'`,
      resolveDir: dir,
      loader: 'js',
    },
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' },
    external: [...EXTERNAL, ...EXTERNAL_REACT],
    write: false,
    logLevel: 'silent',
  })
  const code = result.outputFiles[0].contents
  return { min: code.length, gzip: gzipSync(code, { level: 9 }).length, run: run(entry, code) }
}

/**
 * Runs the measured bundle `code` with the entry's smoke scenario, in production mode: the output
 * when it matches `entry.expect`, else an `Error`. The files go under @datakable/core's node_modules
 * so the externals (core's dependencies, and react from the root) resolve as in an app.
 */
function run(entry, code) {
  const dir = join(root, 'packages/core/node_modules/.cache/datakable-size')
  mkdirSync(dir, { recursive: true })
  const id = `${entry.pkg}-${entry.import.join('-')}`
  writeFileSync(join(dir, `${id}.bundle.mjs`), code)
  const react =
    entry.pkg === 'core'
      ? ''
      : "import * as React from 'react'\nimport * as server from 'react-dom/server'\n"
  const smoke =
    `${react}import { ${entry.import.join(', ')} } from './${id}.bundle.mjs'\n` +
    `process.stdout.write(String(await (async () => { ${entry.smoke} })()))\n`
  const file = join(dir, `${id}.smoke.mjs`)
  writeFileSync(file, smoke)
  let out
  try {
    out = execFileSync(process.execPath, [file], {
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'production' },
    })
  } catch (error) {
    // Node echoes the one-line minified source above the error: keep only the error line.
    const stderr = String(error.stderr)
    out = stderr.split('\n').find((line) => /^\w*Error\b/.test(line)) ?? stderr.slice(-500)
    return new Error(`throws ${out}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  return out === entry.expect
    ? out
    : new Error(`returned ${JSON.stringify(out)}, expected ${JSON.stringify(entry.expect)}`)
}

const kb = (n) => `${(n / 1024).toFixed(2)} KB`
const bytes = (n) => n.toLocaleString('en-US')

async function main() {
  const check = process.argv.includes('--check')
  const rows = []
  for (const entry of entries) rows.push({ entry, ...(await measure(entry)) })

  let grew = 0
  let broken = 0
  for (const { entry, gzip, run } of rows) {
    const overRatchet = gzip > entry.limit
    if (overRatchet) grew++
    if (run instanceof Error) broken++
    const spec =
      entry.budget === undefined
        ? 'spec: none'
        : `spec ≤ ${kb(entry.budget)} ${gzip <= entry.budget ? 'met' : `UNMET (+${kb(gzip - entry.budget)})`}`
    console.log(
      `${overRatchet || run instanceof Error ? '✗' : '✓'} ${entry.name}\n` +
        `    ${bytes(gzip)} B gzip (${kb(gzip)}) | ratchet ≤ ${kb(entry.limit)}` +
        `${overRatchet ? ` EXCEEDED by ${bytes(gzip - entry.limit)} B` : ''} | ${spec}` +
        (run instanceof Error
          ? `\n    RUN FAILED: the bundle ${run.message}\n    smoke: ${entry.smoke}`
          : ''),
    )
  }
  const unmet = rows.filter((r) => r.entry.budget !== undefined && r.gzip > r.entry.budget).length
  console.log(
    `\nsize: ${rows.length} entries, ${broken} failing to run, ${grew} over ratchet, ${unmet} over the` +
      ' §9.3 spec budget (spec gaps are raised with the user, not enforced; ratchets are enforced)',
  )
  if (broken > 0) {
    console.error(
      'size: a measured bundle fails its smoke run (scripts/size-limits.mjs `smoke`): its size is' +
        ' not the size of working code. Fix the bundle before reading or setting any budget.',
    )
    process.exit(1)
  }
  if (check && grew > 0) {
    console.error('size: an entry grew past its ratchet (scripts/size-limits.mjs)')
    process.exit(1)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
