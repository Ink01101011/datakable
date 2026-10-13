// Type-leak guard (spec §12): compile a tiny consumer project against the BUILT packages with
// `skipLibCheck: false`, under `moduleResolution` node16 and bundler. Fails when a published
// `.d.ts` references a type the consumer cannot resolve (e.g. ex-search -> ex-flow), uses an
// invalid module augmentation, or when public types (catalog codes, entry points) break.
// Run after `pnpm build`.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
import 'datakable/messages'
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
export { allMessages, core, d, defineFeature, fromCore, useDataTable }
`,
)

const tsc = createRequire(join(root, 'package.json')).resolve('typescript/bin/tsc')
const configs = {
  node16: { module: 'node16', moduleResolution: 'node16' },
  bundler: { module: 'esnext', moduleResolution: 'bundler' },
}
let failed = false
for (const [name, resolution] of Object.entries(configs)) {
  writeFileSync(
    join(dir, `tsconfig.${name}.json`),
    JSON.stringify({
      compilerOptions: {
        ...resolution,
        target: 'es2022',
        lib: ['es2022', 'dom'],
        strict: true,
        exactOptionalPropertyTypes: true,
        skipLibCheck: false,
        noEmit: true,
        jsx: 'react-jsx',
        types: [],
      },
      files: ['index.ts'],
    }),
  )
  try {
    execFileSync(process.execPath, [tsc, '-p', `tsconfig.${name}.json`], {
      cwd: dir,
      stdio: 'pipe',
    })
    console.log(`check:consumer: ${name} consumer compiles with skipLibCheck: false`)
  } catch (e) {
    failed = true
    console.error(`check:consumer: ${name} consumer FAILED with skipLibCheck: false`)
    console.error(String(e.stdout))
  }
}
if (failed) process.exit(1)
