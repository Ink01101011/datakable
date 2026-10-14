// Package-contents guard for the BUILT packages: every emitted .js / .cjs file carries exactly one
// `//# sourceMappingURL=` comment (#35: a rollup treeshake pass over esbuild output appended a
// second one). Run after `pnpm build`.
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

if (errors.length > 0) {
  for (const e of errors) console.error(`check:dist: ${e}`)
  process.exit(1)
}
console.log(`check:dist: ${files} JS files, one sourceMappingURL each`)
