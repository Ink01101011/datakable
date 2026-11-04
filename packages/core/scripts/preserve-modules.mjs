// Build helpers for tsup (§8.2, §9.1, §12).
import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// `\r?\n`: a Windows checkout with `core.autocrlf=true` has CRLF sources (#81).
const ENV_IMPORT = /^import \{ DEV \} from '((?:\.\.?\/)+(?:diagnostics\/)?)env'(\r?\n)/m
const NODE_ENV = '(process.env.NODE_ENV !== "production")'

/**
 * esbuild plugin: one output file per source module, like rollup's `preserveModules`. Every
 * relative import stays an import (rewritten to the emitted extension) instead of being inlined
 * into one file, so a consumer's bundler sees each module on its own and `sideEffects: false`
 * drops the unused ones.
 *
 * It also writes the `DEV` flag (`diagnostics/env`) out as `process.env.NODE_ENV !== "production"`
 * at every use, and keeps a side-effect import of `diagnostics/process-guard` in its place: without
 * a bundler (no `process`) that module is evaluated before any read and throws a DataKable error
 * naming the fix (#36); a bundler drops it. A consumer's bundler replaces `process.env.NODE_ENV`, and esbuild then folds
 * `DEV && messages.DK_X` / `if (DEV)` while parsing each module, so message objects and dev-only
 * code are never linked into a production bundle. An imported `DEV` binding (or a module-level
 * `const` in a file with imports) is folded only when printing, after tree shaking has already
 * kept everything it guards (§8.2, §9.3).
 *
 * @type {import('esbuild').Plugin}
 */
export const preserveModules = {
  name: 'preserve-modules',
  setup(build) {
    const ext = build.initialOptions.format === 'cjs' ? '.cjs' : '.js'
    build.onResolve({ filter: /^\.\.?\// }, (args) => {
      if (args.kind === 'entry-point') return undefined
      const base = resolve(dirname(args.importer), args.path)
      // `.tsx` too: @datakable/react builds with this plugin (T37).
      if (existsSync(`${base}.ts`) || existsSync(`${base}.tsx`))
        return { path: args.path + ext, external: true }
      if (existsSync(`${base}/index.ts`) || existsSync(`${base}/index.tsx`))
        return { path: `${args.path}/index${ext}`, external: true }
      return undefined // JSON (the package.json version): inlined
    })
    build.onLoad({ filter: /[\\/]src[\\/].*\.ts$/ }, async (args) => {
      const contents = inlineDev(await readFile(args.path, 'utf8'))
      return contents === undefined ? undefined : { contents, loader: 'ts' }
    })
  },
}

/**
 * `src` with its `DEV` import replaced by the `process-guard` import (same line ending) and every
 * `DEV` written out as the `NODE_ENV` check; `undefined` when `src` does not import `DEV`.
 */
export function inlineDev(src) {
  if (!ENV_IMPORT.test(src)) return undefined
  return src
    .replace(ENV_IMPORT, (_, dir, eol) => `import '${dir}process-guard'${eol}`)
    .replace(/\bDEV\b/g, NODE_ENV)
}

/**
 * A `node --input-type=module -e` script that loads the built module at the file URL `url` (`.cjs`
 * with `require`, else `import()`) with no `process` global, and prints `loaded` or the error (#36).
 * `require` takes a filesystem path and `import()` a URL; `URL.pathname` is neither in a path with
 * a space or non-ASCII name (percent-encoded) or on Windows (`/C:/...`) (#82).
 */
export function loadWithoutProcess(url) {
  const cjs = url.pathname.endsWith('.cjs')
  const f = cjs ? fileURLToPath(url) : url.href
  const load = cjs
    ? "p.getBuiltinModule('node:module').createRequire(import.meta.url)(f)"
    : 'await import(f)'
  return (
    `const f = ${JSON.stringify(f)}; ` +
    'const p = globalThis.process; delete globalThis.process; let out = "loaded"; ' +
    `try { ${load} } catch (e) { out = String(e) } ` +
    'p.stdout.write(out)'
  )
}

/** Fails the build when an emitted module still imports `diagnostics/env` (tsup `onSuccess`). */
export async function checkDevInlined(dist) {
  const bad = []
  for (const file of await walk(dist)) {
    if (!/\.c?js$/.test(file)) continue
    const src = await readFile(file, 'utf8')
    if (/(?:from |require\()["'][^"']*diagnostics\/env\.c?js["']|["']\.\/env\.c?js["']/.test(src)) {
      bad.push(file)
    }
  }
  if (bad.length > 0) {
    throw new Error(
      `DEV was not inlined; these modules still import diagnostics/env:\n${bad.join('\n')}`,
    )
  }
}

async function walk(dir) {
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(p)))
    else out.push(p)
  }
  return out
}

const AUGMENT = /declare module '(?:\.\.?\/)+(?:diagnostics\/)?catalog'/g

/**
 * The bundled `.d.ts` keep each codes module's `declare module '../diagnostics/catalog'`
 * augmentation verbatim, but that path does not exist next to the bundle, so a consumer lost every
 * core code from `DiagnosticCatalog` (and `skipLibCheck: false` reports TS2665). Point them at the
 * package itself, the same way plugins augment it (§3.5). Run after tsup (the dts pass finishes
 * after `onSuccess`).
 */
export async function fixDtsAugmentations(dist) {
  let n = 0
  for (const file of await walk(dist)) {
    if (!/\.d\.c?ts$/.test(file)) continue
    const src = await readFile(file, 'utf8')
    const out = src.replace(AUGMENT, () => {
      n++
      return "declare module '@datakable/core'"
    })
    if (out !== src) await writeFile(file, out)
  }
  if (n === 0) throw new Error('fixDtsAugmentations: no DiagnosticCatalog augmentation found')
  return n
}
