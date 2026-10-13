// React Server Components guard (#8): load the BUILT packages the way an RSC bundler's server
// layer does, and fail where Next's webpack build (`next build --webpack`) would.
//
// - Every emitted `.js` module of @datakable/react and datakable that starts with the
//   `"use client"` directive must list its exports by name: Next's webpack RSC transform rejects
//   `export *` in a client boundary ("It's currently unsupported to use "export *" in a client
//   boundary").
// - Under the `react-server` condition, importing `@datakable/react` and `datakable/messages` must
//   work from a server module: `"use client"` modules become client references (as the bundler
//   does), and everything else runs. `createTable` (re-exported from core) must be a real function
//   on the server, `<DataTable />` / `useDataTable` must stay client references.
// Run after `pnpm build`.
import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { register } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isMainThread } from 'node:worker_threads'

const USE_CLIENT = /^(?:\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*(['"])use client\1/
const EXPORT_ALL = /^export \*(?: as \w+)? from /m
const CLIENT_REF = Symbol.for('react.client.reference')

/** Module customization hooks (registered below): the bundler's server layer. */
export async function resolve(specifier, context, next) {
  const conditions = [...new Set([...context.conditions, 'react-server'])]
  return next(specifier, { ...context, conditions })
}

export async function load(url, context, next) {
  const out = await next(url, context)
  if (out.format !== 'module' || !url.startsWith('file:')) return out
  const src = String(out.source)
  if (!USE_CLIENT.test(src)) return out
  if (EXPORT_ALL.test(src)) {
    throw new Error(
      `${fileURLToPath(url)}: It's currently unsupported to use "export *" in a client boundary ` +
        '(Next.js webpack RSC). Fix: list the exports by name, or drop "use client" from this ' +
        'module and keep it only on the modules that use React hooks.',
    )
  }
  // A client reference per export, like react-server-dom-webpack's registerClientReference.
  const stub = exportNames(src)
    .map((name) => {
      const ref = `{ $$typeof: Symbol.for('react.client.reference'), $$id: ${JSON.stringify(`${url}#${name}`)} }`
      return name === 'default' ? `export default ${ref}` : `export const ${name} = ${ref}`
    })
    .join('\n')
  return { format: 'module', source: stub, shortCircuit: true }
}

/** Export names of an esbuild-emitted ESM module (`export { a, b as c }` + declarations). */
function exportNames(src) {
  const names = []
  for (const [, list] of src.matchAll(/^export \{([^}]*)\}/gm)) {
    for (const item of list.split(',')) {
      const name = item
        .trim()
        .split(/\s+as\s+/)
        .pop()
      if (name) names.push(name)
    }
  }
  for (const [, name] of src.matchAll(
    /^export (?:async )?(?:function\*?|const|let|var|class) (\w+)/gm,
  ))
    names.push(name)
  if (/^export default /m.test(src)) names.push('default')
  return names
}

if (isMainThread && process.argv[1] === fileURLToPath(import.meta.url)) await main()

async function main() {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const failures = []

  // 1. Static: no `export *` in any emitted client module.
  for (const pkg of ['react', 'datakable']) {
    const dist = join(root, 'packages', pkg, 'dist')
    for (const file of readdirSync(dist, { recursive: true })) {
      if (!String(file).endsWith('.js')) continue
      const src = readFileSync(join(dist, file), 'utf8')
      if (USE_CLIENT.test(src) && EXPORT_ALL.test(src))
        failures.push(
          `packages/${pkg}/dist/${file}: "use client" module uses \`export *\`, which ` +
            '`next build --webpack` rejects. Fix: list the exports by name, or drop "use client" ' +
            'from this module and keep it only on the modules that use React hooks.',
        )
    }
  }

  // 2. Runtime: import the entries from a server module (react-server condition).
  const dir = join(root, 'node_modules/.cache/rsc-check')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'node_modules/@datakable'), { recursive: true })
  const link = (target, name) => symlinkSync(target, join(dir, 'node_modules', name), 'dir')
  link(join(root, 'packages/core'), '@datakable/core')
  link(join(root, 'packages/react'), '@datakable/react')
  link(join(root, 'packages/datakable'), 'datakable')
  link(join(root, 'node_modules/react'), 'react')
  writeFileSync(
    join(dir, 'server.mjs'),
    `export * as dkReact from '@datakable/react'
import 'datakable/messages'
`,
  )
  register(import.meta.url)
  try {
    const { dkReact } = await import(pathToFileURL(join(dir, 'server.mjs')).href)
    assert.equal(
      typeof dkReact.createTable,
      'function',
      'createTable is not callable on the server',
    )
    const t = dkReact.createTable({ data: [{ id: 1 }, { id: 2 }], rowKey: 'id' })
    assert.equal(t.getRowModel().rows.length, 2)
    for (const name of ['DataTable', 'useDataTable']) {
      assert.equal(
        dkReact[name]?.$$typeof,
        CLIENT_REF,
        `${name} from @datakable/react is not a client reference: its module lost "use client"`,
      )
    }
  } catch (e) {
    failures.push(`server import of @datakable/react / datakable/messages: ${e.message}`)
  }

  if (failures.length > 0) {
    console.error(`check:rsc failed:\n${failures.map((f) => `- ${f}`).join('\n')}`)
    process.exit(1)
  }
  console.log('check:rsc ok: @datakable/react and datakable/messages load in a server module')
}
