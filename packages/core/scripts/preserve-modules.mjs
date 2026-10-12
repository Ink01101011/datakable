// Build helpers for tsup (§8.2, §9.1, §12).
import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const ENV_IMPORT = /^import \{ DEV \} from '(?:\.\.?\/)+(?:diagnostics\/)?env'\n/m
const NODE_ENV = '(process.env.NODE_ENV !== "production")'

/**
 * esbuild plugin: one output file per source module, like rollup's `preserveModules`. Every
 * relative import stays an import (rewritten to the emitted extension) instead of being inlined
 * into one file, so a consumer's bundler sees each module on its own and `sideEffects: false`
 * drops the unused ones.
 *
 * It also writes the `DEV` flag (`diagnostics/env`) out as `process.env.NODE_ENV !== "production"`
 * at every use. A consumer's bundler replaces `process.env.NODE_ENV`, and esbuild then folds
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
      if (existsSync(`${base}.ts`)) return { path: args.path + ext, external: true }
      if (existsSync(`${base}/index.ts`))
        return { path: `${args.path}/index${ext}`, external: true }
      return undefined // JSON (the package.json version): inlined
    })
    build.onLoad({ filter: /[\\/]src[\\/].*\.ts$/ }, async (args) => {
      const src = await readFile(args.path, 'utf8')
      if (!ENV_IMPORT.test(src)) return undefined
      return {
        contents: src.replace(ENV_IMPORT, '').replace(/\bDEV\b/g, NODE_ENV),
        loader: 'ts',
      }
    })
  },
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
