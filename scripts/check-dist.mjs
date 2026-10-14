// Package-contents guard for the BUILT packages: every emitted .js / .cjs file carries exactly one
// `//# sourceMappingURL=` comment (#35: a rollup treeshake pass over esbuild output appended a
// second one), and every package declares `engines.node` (#37). Run after `pnpm build`.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const packages = ['core', 'react', 'datakable']
const errors = []

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  )

let files = 0
for (const pkg of packages) {
  for (const file of walk(join(root, 'packages', pkg, 'dist'))) {
    if (!/\.c?js$/.test(file)) continue
    files++
    const n = readFileSync(file, 'utf8').match(/^\/\/# sourceMappingURL=/gm)?.length ?? 0
    if (n !== 1) {
      errors.push(
        `${relative(root, file)}: ${n} sourceMappingURL comments, expected 1 — check the tsup ` +
          'config of this package (a rollup `treeshake` pass appends a second one)',
      )
    }
  }
}

// Every package declares `engines.node` (#37), and no lower than what its runtime dependencies
// declare: a consumer on an older Node would install a dependency that does not support it.
const manifest = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
const minVersion = (range) => /^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(range ?? '')?.slice(1)
const below = (a, b) => {
  for (let i = 0; i < 3; i++) {
    const d = Number(a[i] ?? 0) - Number(b[i] ?? 0)
    if (d !== 0) return d < 0
  }
  return false
}
for (const pkg of packages) {
  const dir = join(root, 'packages', pkg)
  const { name, engines, dependencies = {} } = manifest(dir)
  const own = minVersion(engines?.node)
  if (!own) {
    errors.push(
      `${name}: package.json needs "engines": { "node": ">=x.y.z" } (got ${JSON.stringify(engines?.node)})`,
    )
    continue
  }
  for (const dep of Object.keys(dependencies)) {
    const required = minVersion(manifest(join(dir, 'node_modules', dep)).engines?.node)
    if (required && below(own, required)) {
      errors.push(
        `${name}: engines.node "${engines.node}" is lower than its dependency ${dep} ` +
          `(>=${required.join('.')}) — raise engines.node in packages/${pkg}/package.json`,
      )
    }
  }
}

if (errors.length > 0) {
  for (const e of errors) console.error(`check:dist: ${e}`)
  process.exit(1)
}
console.log(`check:dist: ${files} JS files, one sourceMappingURL each; engines.node declared`)
