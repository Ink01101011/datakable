// Dist-level diagnostic catalog check (run after `pnpm build`; part of `check:pkg`).
// Tests run on source, so a `defineDiagnostic` that the bundler tree-shakes out of dist goes
// unnoticed there: every DK_* code named in src/ (outside tests) must be in the built catalog.
import { readdirSync, readFileSync, statSync } from 'node:fs'
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
