// Dist-level diagnostic catalog check for @datakable/react (run after `pnpm build`; part of
// `check:pkg`). Like core's scripts/check-catalog.mjs: tests run on source, so a definition that the
// bundler drops from dist (tree-shaking, `sideEffects`) goes unnoticed there (T24 carry-over).
// 1. Every DK_* code named in src/ (outside tests) is in the built catalog (esm + cjs, development).
// 2. Consumer bundles: each import scenario is bundled like an app would (esbuild, minified,
//    NODE_ENV production and development) and run: every code the bundle can emit (each DK_*
//    string left in it) must be registered in that same bundle, with its where/problem/impact/fix
//    in development and without text in production.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = await import(pathToFileURL(join(root, 'dist/index.js')).href)
const cjs = createRequire(import.meta.url)(join(root, 'dist/index.cjs'))

function* sources(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* sources(p)
    else if (/\.tsx?$/.test(name) && !/\.(test|test-d|bench)\.tsx?$/.test(name)) yield p
  }
}

const codes = new Map()
for (const file of sources(join(root, 'src'))) {
  for (const [, code] of readFileSync(file, 'utf8').matchAll(/['"`](DK_[A-Z0-9_]+)['"`]/g)) {
    if (!codes.has(code)) codes.set(code, file.slice(root.length))
  }
}

const missing = []
for (const [code, file] of codes) {
  for (const [label, mod] of [
    ['esm', dist],
    ['cjs', cjs],
  ]) {
    const def = mod.getDiagnosticDefinition(code)
    if (!def) missing.push(`${code} (${label}; named in ${file})`)
    else if (typeof def.where !== 'function' || typeof def.fix !== 'function') {
      missing.push(`${code} (${label}): definition without where/fix`)
    }
  }
}
if (missing.length > 0) {
  console.error(`check:catalog: ${missing.length} code(s) missing from the built catalog:`)
  for (const m of missing) console.error(`  ${m}`)
  console.error('Reference the definition from the emitting module so the bundler keeps it.')
  process.exit(1)
}
console.log(`check:catalog: ${codes.size} codes named in @datakable/react, all defined in dist`)

// --- 2. consumer bundles -------------------------------------------------------------------------
// esbuild is a dev dependency of @datakable/core (one copy in the workspace).
const { build } = createRequire(join(root, '../core/package.json'))('esbuild')
const scenarios = [
  ['DataTable', `import { DataTable } from '@datakable/react'\nkeep(DataTable)`],
  ['useDataTable', `import { useDataTable } from '@datakable/react'\nkeep(useDataTable)`],
  ['import *', `import * as m from '@datakable/react'\nkeep(m)`],
]
const out = join(root, 'node_modules/.cache/check-catalog')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const failures = []
let n = 0
for (const env of ['production', 'development']) {
  for (const [label, body] of scenarios) {
    const file = join(out, `s${n++}.mjs`)
    writeFileSync(
      `${file}.src.mjs`,
      `import { getDiagnosticDefinition } from '@datakable/react'\n` +
        `const keep = (...xs) => { globalThis.__dkKeep = xs }\n${body}\n` +
        'export { getDiagnosticDefinition }\n',
    )
    await build({
      entryPoints: [`${file}.src.mjs`],
      outfile: file,
      bundle: true,
      minify: true,
      format: 'esm',
      platform: 'browser',
      logLevel: 'error',
      define: { 'process.env.NODE_ENV': JSON.stringify(env) },
      // React stays external (resolved from the workspace at run time); core's dependencies are
      // bundled (they resolve from core's directory, not from here).
      external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
      // Resolve `@datakable/react` through its package.json `exports` (the ESM a consumer gets).
      plugins: [
        {
          name: 'self',
          setup(b) {
            b.onResolve({ filter: /^@datakable\/react$/ }, () => ({
              path: join(root, 'dist/index.js'),
            }))
          },
        },
      ],
    })
    const text = readFileSync(file, 'utf8')
    const named = new Set([...text.matchAll(/["'`](DK_[A-Z0-9_]+)["'`]/g)].map((m) => m[1]))
    const mod = await import(pathToFileURL(file).href)
    for (const code of named) {
      const def = mod.getDiagnosticDefinition(code)
      if (!def) failures.push(`${code}: emitted but not defined (${env}, ${label})`)
      else if (typeof def.where !== 'function')
        failures.push(`${code}: no where (${env}, ${label})`)
      else if (
        env === 'development' &&
        !['problem', 'impact', 'fix'].every((k) => typeof def[k] === 'function')
      ) {
        failures.push(`${code}: no problem/impact/fix text in development (${label})`)
      } else if (
        env === 'production' &&
        ['problem', 'impact', 'fix'].some((k) => typeof def[k] === 'function')
      ) {
        failures.push(`${code}: message text shipped in production (${label}); guard it`)
      }
    }
  }
}
if (failures.length > 0) {
  console.error(`check:catalog: ${failures.length} problem(s) in consumer bundles:`)
  for (const f of failures) console.error(`  ${f}`)
  console.error(
    'Use the definitions where the code is emitted (keepDiagnostics) so the bundle keeps them.',
  )
  process.exit(1)
}
console.log(
  `check:catalog: ${scenarios.length} @datakable/react consumer bundles x production/development, ` +
    'every emitted code defined',
)
