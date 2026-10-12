// Dist-level diagnostic catalog check (run after `pnpm build`; part of `check:pkg`).
// Tests run on source, so a `defineDiagnostic` that the bundler tree-shakes out of dist goes
// unnoticed there.
// 1. Every DK_* code named in src/ (outside tests) must be in the built catalog (esm + cjs).
// 2. Consumer bundles: dist is one module per source file with `sideEffects: false`, so a
//    consumer's bundler drops a definitions module nothing really uses. For each import scenario
//    (bare createTable, each feature, each entry point, everything) the scenario is bundled like
//    an app would (esbuild, minified, NODE_ENV production and development) and run: every code the
//    bundle can emit (each DK_* string left in it) must be registered in that same bundle, and in
//    development it must carry its where/problem/impact/fix.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = await import(pathToFileURL(join(root, 'dist/index.js')).href)
const cjs = (await import('node:module')).createRequire(import.meta.url)(
  join(root, 'dist/index.cjs'),
)

function* sources(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* sources(p)
    else if (/\.tsx?$/.test(name) && !/\.test(-d)?\.tsx?$|test-features\.ts$/.test(name)) yield p
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
console.log(`check:catalog: ${codes.size} codes, all defined in dist (esm + cjs)`)

// --- 2. consumer bundles -------------------------------------------------------------------------
const { build } = await import('esbuild')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const entryPaths = Object.keys(pkg.exports).filter(
  (k) => k !== './package.json' && k !== './messages',
)
const spec = (e) => (e === '.' ? '@datakable/core' : `@datakable/core${e.slice(1)}`)
const MESSAGES = "import * from '@datakable/core' + '@datakable/core/messages'"
const FEATURES = ['columnFilters', 'validity', 'search', 'sorting', 'pagination']
const scenarios = [
  ['createTable', `import { createTable } from '@datakable/core'\nkeep(createTable)`],
  ...FEATURES.map((f) => [
    `createTable + ${f}`,
    `import { createTable, ${f} } from '@datakable/core'\nkeep(createTable, ${f})`,
  ]),
  ...entryPaths.map((e) => [
    `import * from '${spec(e)}'`,
    `import * as m from '${spec(e)}'\nkeep(m)`,
  ]),
  // Opted-in production text: every code the bundle can emit must have message text.
  [
    MESSAGES,
    "import * as m from '@datakable/core'\nimport { allMessages } from '@datakable/core/messages'\n" +
      'keep(m)\nexport { allMessages }',
  ],
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
      `import { getDiagnosticDefinition } from '@datakable/core'\n` +
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
      external: ['ex-search', 'exsorted', 'exsorted/*', 'kk-debounce', 'kk-debounce/*'],
      // Resolve `@datakable/core[/x]` through package.json `exports` (the ESM a consumer gets).
      plugins: [
        {
          name: 'self',
          setup(b) {
            b.onResolve({ filter: /^@datakable\/core(\/|$)/ }, (a) => {
              const key = `.${a.path.slice('@datakable/core'.length)}`
              return { path: join(root, pkg.exports[key].import.default) }
            })
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
        label === MESSAGES &&
        !mod.allMessages.some((m) => Object.hasOwn(m, code))
      ) {
        failures.push(`${code}: no text in @datakable/core/messages (production)`)
      }
    }
  }
}
if (failures.length > 0) {
  console.error(`check:catalog: ${failures.length} problem(s) in consumer bundles:`)
  for (const f of failures) console.error(`  ${f}`)
  console.error(
    'Use the definitions where the code is emitted (useDiagnostics) so the bundle keeps them.',
  )
  process.exit(1)
}
console.log(
  `check:catalog: ${scenarios.length} consumer bundles x production/development, every emitted ` +
    'code defined',
)
