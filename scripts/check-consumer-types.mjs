// Type-leak guard (spec §12): compile a tiny consumer project against the BUILT packages with
// `skipLibCheck: false`, under `moduleResolution` node16, bundler and node10, with the current TypeScript
// and the minimum supported one (#32). Fails when a published `.d.ts` references a type the
// consumer cannot resolve (e.g. ex-search -> ex-flow), uses an invalid module augmentation, needs
// a newer TypeScript than documented, or when public types (catalog codes, entry points) break.
// Run after `pnpm build`.
import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dir = join(root, 'node_modules/.cache/consumer-types')
rmSync(dir, { recursive: true, force: true })
mkdirSync(join(dir, 'node_modules/@datakable'), { recursive: true })
mkdirSync(join(dir, 'node_modules/@types'), { recursive: true })
const link = (target, name) => symlinkSync(target, join(dir, 'node_modules', name), 'dir')
link(join(root, 'packages/core'), '@datakable/core')
link(join(root, 'packages/react'), '@datakable/react')
link(join(root, 'packages/datakable'), 'datakable')
link(join(root, 'node_modules/react'), 'react')
link(join(root, 'node_modules/@types/react'), '@types/react')
// @types/react's own dependency, found next to it in pnpm's store; the node10 config resolves from
// the symlinked paths (preserveSymlinks, as in an npm install), where it is not otherwise visible.
link(join(realpathSync(join(root, 'node_modules/@types/react')), '../../csstype'), 'csstype')

writeFileSync(
  join(dir, 'package.json'),
  JSON.stringify({ name: 'consumer', private: true, type: 'module' }),
)
writeFileSync(
  join(dir, 'index.ts'),
  `import {
  buildDiagnostic,
  type ColumnDef,
  createTable as createCoreTable,
  type Diagnostic,
  type DiagnosticCode,
  defineDiagnostic,
  defineFeature,
} from '@datakable/core'
import { columnFilters } from '@datakable/core/column-filters'
import { allMessages } from '@datakable/core/messages'
import { pagination } from '@datakable/core/pagination'
import { search } from '@datakable/core/search'
import { sorting } from '@datakable/core/sorting'
import { validity } from '@datakable/core/validity'
import { useDataTable } from '@datakable/react'
import { createTable } from 'datakable'
import { DataTable, useDataTable as usePresetTable } from 'datakable/react'
import 'datakable/messages'
import '@datakable/react/messages'
// The stylesheet exports carry types (#34): TS 6 checks side-effect imports by default.
import 'datakable/styles.css'
import '@datakable/react/styles.css'
import { createTable as fromCore } from 'datakable/core'

type User = { id: number; name: string; address: { city: string } }
declare const users: User[]

// A plugin adds a code through declaration merging (§3.5).
declare module '@datakable/core' {
  interface DiagnosticCatalog {
    DK_CONSUMER_PLUGIN: { field: string }
  }
}
export const def = defineDiagnostic({
  code: 'DK_CONSUMER_PLUGIN',
  level: 'warn',
  where: (d) => ({ kind: 'option', path: d.field }),
  problem: (d) => \`bad \${d.field}\`,
  impact: () => 'ignored',
  fix: () => ['fix it'],
})

// Core's own codes are part of the public DiagnosticCode union.
const core: DiagnosticCode[] = ['DK_TABLE_DESTROYED', 'DK_SORT_STRATEGY', 'DK_CONSUMER_PLUGIN']
const d: Diagnostic = buildDiagnostic('DK_TABLE_DESTROYED', { method: 'setState' })
// @ts-expect-error not a catalog code
buildDiagnostic('DK_NOT_A_CODE', {})

const columns: ColumnDef<User>[] = [{ id: 'city', accessor: (u) => u.address.city }]
const t = createCoreTable({
  data: users,
  columns,
  features: [columnFilters(), validity(), search(), sorting(), pagination()],
})
t.toggleSort('address.city')
// @ts-expect-error not a path of User
t.toggleSort('nope')
const z = createTable({ data: users })
z.setSearch('x')
const preset = () => usePresetTable({ data: users }).setSearch('x')
export { allMessages, core, d, DataTable, defineFeature, fromCore, preset, useDataTable }
`,
)

// A CommonJS consumer (.cts, checked under node16): the stylesheet's `types` condition resolves to
// a .d.cts, not the ESM .d.ts that a `require` cannot load (TS1479).
writeFileSync(
  join(dir, 'index-cjs.cts'),
  `import 'datakable/styles.css'
import '@datakable/react/styles.css'
import { createTable } from 'datakable'
export const z = createTable({ data: [{ id: 1 }], rowKey: 'id' })
`,
)

const req = createRequire(join(root, 'package.json'))
// The current TypeScript, and the minimum the docs promise (getting-started, READMEs: TS >= 5.4,
// #32): the root devDependency `typescript-min` pins it, so a published .d.ts that needs a newer
// TS (as `NoInfer` needs 5.4) fails here instead of in a consumer's build.
const compilers = ['typescript', 'typescript-min'].map((pkg) => ({
  tsc: req.resolve(`${pkg}/bin/tsc`),
  version: req(`${pkg}/package.json`).version,
}))
// node10 (`moduleResolution: node`, #33) ignores `exports`: the subpaths resolve through the
// packages' `typesVersions`. TS 6 deprecates node10, hence `ignoreDeprecations` there.
const configs = {
  node16: { module: 'node16', moduleResolution: 'node16', files: ['index.ts', 'index-cjs.cts'] },
  bundler: { module: 'esnext', moduleResolution: 'bundler', files: ['index.ts'] },
  node10: {
    module: 'commonjs',
    moduleResolution: 'node10',
    preserveSymlinks: true,
    files: ['index.ts'],
  },
}
let failed = false
for (const [name, { files, ...resolution }] of Object.entries(configs)) {
  for (const { tsc, version } of compilers) {
    const major = Number(version.split('.')[0])
    const config = `tsconfig.${name}.ts${major}.json`
    writeFileSync(
      join(dir, config),
      JSON.stringify({
        compilerOptions: {
          ...resolution,
          ...(name === 'node10' && major >= 6 ? { ignoreDeprecations: '6.0' } : {}),
          target: 'es2022',
          lib: ['es2022', 'dom'],
          strict: true,
          exactOptionalPropertyTypes: true,
          skipLibCheck: false,
          noEmit: true,
          jsx: 'react-jsx',
          types: [],
        },
        files,
      }),
    )
    const label = `${name} consumer (TypeScript ${version})`
    try {
      execFileSync(process.execPath, [tsc, '-p', config], { cwd: dir, stdio: 'pipe' })
      console.log(`check:consumer: ${label} compiles with skipLibCheck: false`)
    } catch (e) {
      failed = true
      console.error(`check:consumer: ${label} FAILED with skipLibCheck: false`)
      console.error(String(e.stdout))
    }
  }
}
if (failed) process.exit(1)
