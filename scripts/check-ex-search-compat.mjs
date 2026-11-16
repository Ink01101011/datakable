// The BUILT @datakable/core with an `ex-search` that predates `search(q, { within })` and
// `canNarrow` (1.2.0, forced by an override): both module formats load, search falls back to the
// built-in exact / prefix / substring matching, and development reports DK_DEP_INCOMPATIBLE. A named
// ESM import of an export the dependency lacks is a link-time error that would stop the package
// loading before the probe runs. Run after `pnpm build`.
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const core = join(root, 'packages', 'core')

// ex-search 1.2.0's exports (ESM and CJS): `ExSearch`, `Scorer`, `createSearch`, `search`; no
// `canNarrow`, no `within`.
const stub = `class ExSearch {
  constructor(config) { this.config = config; this.data = [] }
  setData(data) { this.data = data; return this }
  search() { throw new Error('ex-search stub: search() must not be called after the probe fails') }
}
const Scorer = {}
const createSearch = (config) => new ExSearch(config)
const search = () => []
`

const dir = mkdtempSync(join(tmpdir(), 'dk-ex-search-compat-'))
const errors = []
try {
  const modules = join(dir, 'node_modules')
  const own = join(modules, '@datakable', 'core')
  mkdirSync(own, { recursive: true })
  // Copied, not linked: a link resolves `ex-search` from the real package (the installed 2.x).
  cpSync(join(core, 'package.json'), join(own, 'package.json'))
  cpSync(join(core, 'dist'), join(own, 'dist'), { recursive: true })
  for (const dep of ['exsorted', 'kk-debounce']) {
    symlinkSync(realpathSync(join(core, 'node_modules', dep)), join(modules, dep), 'dir')
  }
  const ex = join(modules, 'ex-search')
  mkdirSync(ex)
  writeFileSync(
    join(ex, 'package.json'),
    JSON.stringify({
      name: 'ex-search',
      version: '1.2.0',
      exports: { '.': { import: './index.mjs', require: './index.cjs' } },
    }),
  )
  writeFileSync(join(ex, 'index.mjs'), `${stub}export { ExSearch, Scorer, createSearch, search }\n`)
  writeFileSync(
    join(ex, 'index.cjs'),
    `${stub}module.exports = { ExSearch, Scorer, createSearch, search }\n`,
  )

  const body = `
const seen = []
const t = createTable({
  data: [{ name: 'Ada' }, { name: 'Bob' }, { name: 'Adams' }, { name: 'Cada' }],
  columns: [{ key: 'name', search: 1 }],
  features: [search()],
  onDiagnostic: (d) => seen.push(d.code),
})
t.getRowModel()
await t.setSearch('ada')
const m = t.getRowModel()
console.log(JSON.stringify({ rows: m.rows.map((r) => r.index), status: m.status, codes: seen }))
`
  const esm = `import { createTable } from '@datakable/core'\nimport { search } from '@datakable/core/search'\n${body}`
  const cjs = `const { createTable } = require('@datakable/core')\nconst { search } = require('@datakable/core/search')\n;(async () => {${body}})()`
  for (const [format, code, flag] of [
    ['ESM', esm, '--input-type=module'],
    ['CJS', cjs, '--input-type=commonjs'],
  ]) {
    for (const mode of ['development', 'production']) {
      const child = spawnSync(process.execPath, [flag, '-e', code], {
        cwd: dir,
        env: { ...process.env, NODE_ENV: mode },
        encoding: 'utf8',
        timeout: 60_000,
      })
      const label = `${format} ${mode}`
      if (child.status !== 0) {
        errors.push(`${label}: exit ${child.status}\n${child.stderr || child.stdout}`)
        continue
      }
      const out = JSON.parse(child.stdout.trim().split('\n').at(-1))
      // Exact 1 · prefix 0.8 · substring 0.65 (search-index.ts containsMatcher).
      if (JSON.stringify(out.rows) !== '[0,2,3]' || out.status !== 'idle') {
        errors.push(`${label}: expected rows [0,2,3] idle (fallback), got ${JSON.stringify(out)}`)
      }
      const reported = out.codes.includes('DK_DEP_INCOMPATIBLE')
      if (reported !== (mode === 'development')) {
        errors.push(`${label}: DK_DEP_INCOMPATIBLE ${reported ? 'reported' : 'missing'}`)
      }
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

if (errors.length > 0) {
  for (const e of errors) console.error(`check:ex-search-compat: ${e}`)
  process.exit(1)
}
console.log(
  'check:ex-search-compat: @datakable/core (ESM and CJS, development and production) loads with ' +
    'ex-search 1.2.0 and falls back to exact / prefix / substring matching',
)
