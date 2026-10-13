import type { RepoFile } from './docs-check'

/**
 * The files the docs tests read (V1): the docs pages, the READMEs and `./docs-examples/`. Test-only
 * (not an entry point of the package). New pages and example files are picked up with no
 * registration.
 */

// No @types/node here: declare just what is read.
const fs = (await import('node:fs' as string)) as {
  readFileSync(path: URL, encoding: 'utf8'): string
  readdirSync(path: URL, options: { recursive: true }): string[]
  statSync(path: URL): { isFile(): boolean }
  existsSync(path: URL): boolean
}

const root = new URL('../../../', import.meta.url)
const examplesDir = new URL('./docs-examples/', import.meta.url)

/** The READMEs the docs tests cover, besides `docs/`. */
export const READMES = [
  'README.md',
  'packages/core/README.md',
  'packages/react/README.md',
  'packages/datakable/README.md',
]

/** Files under `dir`, recursively, as `/`-separated paths relative to it. */
const walk = (dir: URL): string[] =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { recursive: true })
        .map((p) => p.replaceAll('\\', '/'))
        .filter((p) => fs.statSync(new URL(p, dir)).isFile())
        .sort()
    : []

/** A repository file's text (`path` relative to the repository root). */
export const readRepo = (path: string) => fs.readFileSync(new URL(path, root), 'utf8')

/** A file or directory exists (`''` is the repository root). */
export const existsInRepo = (path: string) =>
  fs.existsSync(new URL(path === '' ? './' : path, root))

/** The `.md` pages under `docs/`, minus the specs and plans in `docs/superpowers/`. */
export const docsPages = (): RepoFile[] =>
  walk(new URL('docs/', root))
    .map((p) => `docs/${p}`)
    .filter((p) => p.endsWith('.md') && !p.startsWith('docs/superpowers/'))
    .map((path) => ({ path, text: readRepo(path) }))

/** The files of `./docs-examples/` (paths relative to it). */
export const docsExamples = (): RepoFile[] =>
  walk(examplesDir).map((path) => ({
    path,
    text: fs.readFileSync(new URL(path, examplesDir), 'utf8'),
  }))
