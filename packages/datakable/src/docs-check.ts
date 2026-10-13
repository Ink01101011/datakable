/**
 * Helpers of the docs tests (V1): `docs-examples.test.ts` (every TypeScript block of a docs page is a
 * compiled file of `./docs-examples/`) and `docs-links.test.ts` (every relative link resolves, down
 * to the heading). Pure functions over `{ path, text }` lists, so the tests can feed them fixtures as
 * well as the real tree. Test-only (not an entry point of the package).
 */

/** A file of the repository: `path` is relative to the repository root, `/`-separated. */
export interface RepoFile {
  path: string
  text: string
}

/** One fenced code block. `line` is 1-based (the opening fence). */
export interface Fence {
  lang: string
  code: string
  /** The opening fence is indented (e.g. inside a list item). */
  indented: boolean
  line: number
  /** The closing fence's line (the page's last line when the block is not closed). */
  end: number
}

const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)/

/** The fenced code blocks of a Markdown page, in order. */
export function fences(md: string): Fence[] {
  const out: Fence[] = []
  const lines = md.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i] as string)
    if (!open) continue
    const [, indent = '', marker = '', lang = ''] = open
    const close = new RegExp(`^\\s*${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`)
    let j = i + 1
    while (j < lines.length && !close.test(lines[j] as string)) j++
    out.push({
      lang,
      code: lines
        .slice(i + 1, j)
        .map((l) => l.slice(Math.min(indent.length, /^\s*/.exec(l)?.[0].length ?? 0)))
        .join('\n')
        .trim(),
      indented: indent.length > 0,
      line: i + 1,
      end: Math.min(j + 1, lines.length),
    })
    i = j
  }
  return out
}

/** The page with every fenced block's lines blanked (line numbers kept): prose only. */
function prose(md: string): string[] {
  const lines = md.split('\n')
  for (const f of fences(md)) lines.fill('', f.line - 1, f.end)
  return lines
}

/**
 * GitHub's heading anchor (github-slugger): inline Markdown reduced to its text, lower case,
 * punctuation other than `-` / `_` removed, each space → `-`.
 */
export function githubSlug(heading: string): string {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-')
}

/** Every anchor a page defines: its headings (`-1`, `-2`, … for repeats) and `<a id|name="…">`. */
export function anchors(md: string): Set<string> {
  const out = new Set<string>()
  const seen = new Map<string, number>()
  for (const line of prose(md)) {
    const h = /^#{1,6}\s+(.*?)(?:\s+#+)?\s*$/.exec(line)
    if (h) {
      const slug = githubSlug(h[1] as string)
      const n = seen.get(slug) ?? 0
      seen.set(slug, n + 1)
      out.add(n === 0 ? slug : `${slug}-${n}`)
    }
    for (const a of line.matchAll(/<a\s[^>]*\b(?:id|name)="([^"]+)"/g)) out.add(a[1] as string)
  }
  return out
}

/** A link of a page, as written. */
export interface Link {
  target: string
  line: number
}

/** The links of a page outside code: inline `[t](x)`, images, and reference definitions. */
export function links(md: string): Link[] {
  const out: Link[] = []
  prose(md).forEach((raw, i) => {
    // Code spans hold no links (`[a](b)` in backticks is text).
    const line = raw.replace(/`[^`]*`/g, '')
    for (const m of line.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      out.push({ target: m[1] as string, line: i + 1 })
    }
    const ref = /^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/.exec(line)
    if (ref) out.push({ target: ref[1] as string, line: i + 1 })
  })
  return out
}

/** This repository on GitHub: links to it are checked against the working tree. */
const REPO = /^https:\/\/github\.com\/Ink01101011\/datakable\/(?:blob|tree)\/main\/([^#?]*)(#.*)?$/

/** `a/b/../c/./d` → `a/c/d`; `null` when it climbs above the root. */
function normalizePath(path: string): string | null {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length === 0) return null
      out.pop()
    } else out.push(part)
  }
  return out.join('/')
}

const dirname = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))

/**
 * Where a link of `from` points: a repository path (`''` = the root) and an optional anchor, or
 * `undefined` for links outside the repository (other sites, `mailto:`).
 */
export function resolveLink(
  from: string,
  target: string,
): { path: string | null; anchor?: string } | undefined {
  const repo = REPO.exec(target)
  let pathPart: string
  let anchor: string | undefined
  if (repo) {
    pathPart = `/${decodeURIComponent(repo[1] as string)}`
    anchor = repo[2]?.slice(1)
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) {
    return undefined
  } else {
    const hash = target.indexOf('#')
    pathPart = decodeURIComponent((hash < 0 ? target : target.slice(0, hash)).split('?')[0] ?? '')
    anchor = hash < 0 ? undefined : target.slice(hash + 1)
  }
  const path =
    pathPart === ''
      ? from
      : normalizePath(pathPart.startsWith('/') ? pathPart : `${dirname(from)}/${pathPart}`)
  return anchor === undefined || anchor === '' ? { path } : { path, anchor }
}

/** What the link check needs from the file system (repository-relative paths). */
export interface Tree {
  /** A file or a directory exists at `path` (`''` is the root). */
  exists(path: string): boolean
  /** A Markdown file's text. */
  read(path: string): string
}

/** Every broken link of `pages`, as `page:line → target (reason)`. */
export function brokenLinks(pages: RepoFile[], tree: Tree): string[] {
  const problems: string[] = []
  const anchorCache = new Map<string, Set<string>>()
  for (const page of pages) {
    for (const link of links(page.text)) {
      const to = resolveLink(page.path, link.target)
      if (to === undefined) continue
      const at = `${page.path}:${link.line} → ${link.target}`
      if (to.path === null) {
        problems.push(`${at} (points above the repository root)`)
        continue
      }
      if (!tree.exists(to.path)) {
        problems.push(`${at} (no file ${to.path})`)
        continue
      }
      // Anchors are checked in Markdown targets only (`file.ts#L10` is GitHub's line link).
      if (to.anchor === undefined || !to.path.endsWith('.md')) continue
      let set = anchorCache.get(to.path)
      if (set === undefined) {
        set = anchors(to.path === page.path ? page.text : tree.read(to.path))
        anchorCache.set(to.path, set)
      }
      if (!set.has(to.anchor)) problems.push(`${at} (no heading #${to.anchor} in ${to.path})`)
    }
  }
  return problems
}

/** The docs pages (`.md` under `root`) not reachable by relative links from `root`/README.md. */
export function unreachable(pages: RepoFile[], root = 'docs'): string[] {
  const byPath = new Map(pages.map((p) => [p.path, p]))
  const seen = new Set<string>()
  const queue = [`${root}/README.md`]
  while (queue.length > 0) {
    const path = queue.pop() as string
    const page = byPath.get(path)
    if (page === undefined || seen.has(path)) continue
    seen.add(path)
    for (const link of links(page.text)) {
      const to = resolveLink(path, link.target)
      if (to?.path?.endsWith('.md')) queue.push(to.path)
    }
  }
  return pages.map((p) => p.path).filter((p) => !seen.has(p))
}

// ——— The drift check ———

/** The folder of a page's examples: `docs/how-to-use/sorting.md` → `how-to-use/sorting`. */
export const examplesFolder = (page: string, root = 'docs') =>
  page.slice(root.length + 1).replace(/\.md$/, '')

/** An example file name: `<n>-<slug>.ts` / `.tsx`. */
const EXAMPLE = /^(\d+)-[a-z0-9][a-z0-9-]*\.(ts|tsx)$/

/**
 * Every mismatch between the docs pages and the example files. `examples` paths are relative to
 * the examples directory (`how-to-use/sorting/1-basic.ts`). Rules:
 * - the n-th ```ts / ```tsx block of `docs/<p>.md` is `<p>/<n>-<slug>.<lang>`, and its text is
 *   that file's text (both trimmed); files are numbered 1..N with no gap or repeat;
 * - every example file is a block of its page; files or folders starting with `_` are helpers
 *   (imported by examples, not shown);
 * - ```typescript and indented ```ts / ```tsx fences are refused: they would escape the check.
 */
export function driftProblems(
  pages: RepoFile[],
  examples: RepoFile[],
  skip: (page: string) => boolean,
  root = 'docs',
): string[] {
  const problems: string[] = []
  const shown = new Set<string>()
  const byPath = new Map(examples.map((e) => [e.path, e]))
  for (const page of pages) {
    const all = fences(page.text)
    for (const f of all) {
      if (f.lang === 'typescript' || f.lang === 'javascript' || f.lang === 'js') {
        problems.push(`${page.path}:${f.line}: write \`\`\`ts / \`\`\`tsx, not \`\`\`${f.lang}`)
      } else if (f.indented && (f.lang === 'ts' || f.lang === 'tsx')) {
        problems.push(`${page.path}:${f.line}: a \`\`\`${f.lang} block must start at column 0`)
      }
    }
    if (skip(page.path)) continue
    const folder = examplesFolder(page.path, root)
    const blocks = all.filter((f) => !f.indented && (f.lang === 'ts' || f.lang === 'tsx'))
    blocks.forEach((block, i) => {
      const n = i + 1
      const files = examples.filter((e) => {
        const name = e.path.slice(folder.length + 1)
        return e.path.startsWith(`${folder}/`) && EXAMPLE.exec(name)?.[1] === String(n)
      })
      const at = `${page.path}:${block.line} (block ${n})`
      if (files.length !== 1) {
        problems.push(
          files.length === 0
            ? `${at}: no example file docs-examples/${folder}/${n}-<slug>.${block.lang}`
            : `${at}: several files numbered ${n}: ${files.map((f) => f.path).join(', ')}`,
        )
        return
      }
      const file = files[0] as RepoFile
      shown.add(file.path)
      if (!file.path.endsWith(`.${block.lang}`)) {
        problems.push(`${at}: a \`\`\`${block.lang} block, but the file is ${file.path}`)
      }
      if (file.text.trim() !== block.code) {
        problems.push(`${at}: the block differs from docs-examples/${file.path}`)
      }
    })
  }
  for (const e of examples) {
    if (shown.has(e.path) || e.path.split('/').some((part) => part.startsWith('_'))) continue
    const name = e.path.slice(e.path.lastIndexOf('/') + 1)
    problems.push(
      EXAMPLE.test(name)
        ? `docs-examples/${e.path} is not shown: no matching block in ${root}/${dirname(e.path)}.md`
        : `docs-examples/${e.path}: name it <n>-<slug>.ts(x), or prefix a helper with _`,
    )
  }
  if (byPath.size !== examples.length) problems.push('duplicate example paths')
  return problems
}
