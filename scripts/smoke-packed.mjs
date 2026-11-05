// Engines-floor smoke test (#84): install the PACKED tarballs into a scratch npm project, the way a
// consumer gets them, and load them on the Node that runs this script (CI: Node 18.18, the
// `engines.node` floor of the published packages). It checks:
// - ESM `import` of `datakable`, `datakable/core`, `datakable/messages` and `datakable/react`, a
//   `createTable` with the default preset, and `renderToString(<DataTable />)` from react-dom;
// - CJS `require` of the same entries.
// Usage: `node scripts/smoke-packed.mjs <dir with the .tgz files>`, after
// `pnpm -r --filter "./packages/*" pack --pack-destination <dir>`. Needs the npm registry (React).
// Keep this file runnable on Node 18: no APIs newer than the floor.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const from = process.argv[2]
if (!from) {
  console.error('usage: node scripts/smoke-packed.mjs <dir with the packed .tgz files>')
  process.exit(2)
}
const tarballs = readdirSync(from)
  .filter((f) => f.endsWith('.tgz'))
  .map((f) => resolve(from, f))
if (tarballs.length !== 3) {
  console.error(`smoke:packed: expected the 3 packed packages in ${from}, found ${tarballs.length}`)
  process.exit(2)
}

// In the OS temp directory: inside the repo, Node would find the workspace's node_modules.
const dir = mkdtempSync(join(tmpdir(), 'datakable-packed-'))
const win = process.platform === 'win32'
const exec = (cmd, args) =>
  execFileSync(cmd, args, { cwd: dir, encoding: 'utf8', stdio: 'pipe', shell: win })

const smoke = (dk, dkr, server, react) => `
const t = ${dk}.createTable({ data: [{ id: 2, n: 'b' }, { id: 1, n: 'a' }], rowKey: 'id' })
t.toggleSort('n')
const ids = t.getRowModel().rows.map((r) => r.original.id).join(',')
if (ids !== '1,2') throw new Error('createTable without its default preset: got ' + ids)
if (typeof ${dk}.VERSION !== 'string') throw new Error('datakable has no VERSION')
const html = ${server}.renderToString(
  ${react}.createElement(${dkr}.DataTable, { data: [{ id: 1, n: 'a' }], rowKey: 'id' }),
)
if (!html.includes('data-datakable')) throw new Error('renderToString(<DataTable />): ' + html)
console.log('rows ' + ids + ' VERSION ' + ${dk}.VERSION + ' html ' + html.length + ' chars')
`

let failed = false
try {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'packed', private: true }))
  exec('npm', ['install', '--no-audit', '--no-fund', ...tarballs, 'react@19', 'react-dom@19'])
  writeFileSync(
    join(dir, 'main.mjs'),
    `import * as dk from 'datakable'
import * as core from 'datakable/core'
import 'datakable/messages'
import * as dkr from 'datakable/react'
import * as React from 'react'
import * as server from 'react-dom/server'
if (typeof core.createTable !== 'function') throw new Error('datakable/core has no createTable')
${smoke('dk', 'dkr', 'server', 'React')}`,
  )
  writeFileSync(
    join(dir, 'main.cjs'),
    `const dk = require('datakable')
const core = require('datakable/core')
require('datakable/messages')
const dkr = require('datakable/react')
const React = require('react')
const server = require('react-dom/server')
if (typeof core.createTable !== 'function') throw new Error('datakable/core has no createTable')
${smoke('dk', 'dkr', 'server', 'React')}`,
  )
  for (const file of ['main.mjs', 'main.cjs']) {
    try {
      const out = execFileSync(process.execPath, [file], { cwd: dir, encoding: 'utf8' })
      console.log(`smoke:packed ${file} on Node ${process.versions.node}: ${out.trim()}`)
    } catch (e) {
      failed = true
      console.error(`smoke:packed ${file} on Node ${process.versions.node} failed:\n${e.stderr}`)
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
if (failed) process.exit(1)
