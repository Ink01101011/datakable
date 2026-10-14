// Framework-free root guard (#63), against the BUILT packages, in plain Node (no bundler):
// - With React NOT installed, `datakable`, `datakable/core` and `datakable/messages` load (ESM
//   `import` and CJS `require`) and `createTable` runs with the default preset. Only
//   `datakable/react` needs React.
// - `node --conditions=react-server` (React installed, no bundler, no client-reference transform)
//   loads the same three entries: none of them reaches a `"use client"` module or a React hook.
// - `react` is an optional peer of `datakable` and `@datakable/react` (`peerDependenciesMeta`), so
//   npm / pnpm do not install it for a project that only uses the framework-free entries.
// The packages are installed as a consumer gets them: a real directory holding `package.json` and
// `dist` only (a symlink to the workspace package would also expose its dev `node_modules/react`),
// resolved with `--preserve-symlinks`, in the OS temp directory (inside the repo, Node would find
// the workspace's `node_modules/react` by walking up). Run after `pnpm build`.
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const failures = []
const temp = []

for (const pkg of ['datakable', 'react']) {
  const json = JSON.parse(readFileSync(join(root, 'packages', pkg, 'package.json'), 'utf8'))
  if (json.peerDependenciesMeta?.react?.optional !== true)
    failures.push(
      `packages/${pkg}/package.json: \`react\` is a required peer, so npm / pnpm install React for ` +
        'every `datakable` user. Fix: add `"peerDependenciesMeta": { "react": { "optional": true } }`.',
    )
}

/** A consumer project with the built packages (and React when `withReact`). */
function project(name, withReact) {
  const dir = mkdtempSync(join(tmpdir(), `datakable-${name}-`))
  temp.push(dir)
  const nm = join(dir, 'node_modules')
  mkdirSync(join(nm, '@datakable'), { recursive: true })
  for (const [pkg, as] of [
    ['core', '@datakable/core'],
    ['react', '@datakable/react'],
    ['datakable', 'datakable'],
  ]) {
    mkdirSync(join(nm, as))
    for (const f of ['package.json', 'dist'])
      symlinkSync(join(root, 'packages', pkg, f), join(nm, as, f))
  }
  // @datakable/core's dependencies (their React peers are optional).
  for (const dep of ['ex-search', 'exsorted', 'kk-debounce'])
    symlinkSync(realpathSync(join(root, 'packages/core/node_modules', dep)), join(nm, dep), 'dir')
  if (withReact) symlinkSync(join(root, 'node_modules/react'), join(nm, 'react'), 'dir')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, private: true }))
  return dir
}

// The default preset sorts: rows come back a, b after `toggleSort`.
const smoke = (dk) => `{
  const t = ${dk}.createTable({ data: [{ id: 2, n: 'b' }, { id: 1, n: 'a' }], rowKey: 'id' })
  t.toggleSort('n')
  const ids = t.getRowModel().rows.map((r) => r.original.id).join(',')
  if (ids !== '1,2') throw new Error('createTable without its default preset: got ' + ids)
}`
const esm = `import * as dk from 'datakable'
import * as core from 'datakable/core'
import 'datakable/messages'
${smoke('dk')}
if (typeof core.createTable !== 'function') throw new Error('datakable/core has no createTable')
if ('useDataTable' in dk || 'DataTable' in dk)
  throw new Error('the datakable root exports React APIs; they belong to datakable/react')
`
const cjs = `const dk = require('datakable')
require('datakable/core')
require('datakable/messages')
${smoke('dk')}
`

function run(dir, label, args, file, source) {
  writeFileSync(join(dir, file), source)
  try {
    execFileSync(process.execPath, ['--preserve-symlinks', ...args, file], {
      cwd: dir,
      stdio: 'pipe',
    })
  } catch (e) {
    const err = String(e.stderr)
    const line = err.split('\n').find((l) => /^\w*Error\b/.test(l)) ?? err.trim().split('\n')[0]
    failures.push(
      `${label}: ${line.trim()}. Fix: keep \`datakable\`, \`datakable/core\` and ` +
        '`datakable/messages` free of React imports and "use client" modules; React APIs ' +
        'belong to `datakable/react`.',
    )
  }
}

const noReact = project('framework-free', false)
run(noReact, 'import of datakable without React installed', [], 'main.mjs', esm)
run(noReact, 'require of datakable without React installed', [], 'main.cjs', cjs)
const server = project('framework-free-rsc', true)
run(
  server,
  'node --conditions=react-server import of datakable',
  ['--conditions=react-server'],
  'main.mjs',
  esm,
)

for (const dir of temp) rmSync(dir, { recursive: true, force: true })
if (failures.length > 0) {
  console.error(`check:framework-free failed:\n${failures.map((f) => `- ${f}`).join('\n')}`)
  process.exit(1)
}
console.log(
  'check:framework-free ok: datakable, datakable/core and datakable/messages load without React ' +
    '(import + require) and under node --conditions=react-server; react is an optional peer',
)
