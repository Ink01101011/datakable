/**
 * Helpers of the `docs/errors.md` tests (T38, §8.3, §11): parse the page into one section per code,
 * and capture what the dev console sink prints, so each example's output block can be compared
 * with what DataKable really prints. Test-only (not an entry point of the package).
 */

/** One `### DK_*` section of docs/errors.md (`##` also accepted). */
export interface ErrorSection {
  code: string
  /** The GitHub anchor of the heading (what `docs/errors.md#<anchor>` links to). */
  anchor: string
  body: string
  /** The `**Problem.**`, `**Common causes.**`, `**Fix.**` and `**Example.**` parts that exist. */
  parts: string[]
  /** The example's TypeScript block, if it has one. */
  code_block?: { lang: string; source: string }
  /** The example's console output block. */
  output?: string
}

export const PARTS = ['Problem', 'Common causes', 'Fix', 'Example'] as const

/** GitHub's heading anchor: lower case, punctuation other than `-` / `_` removed, spaces → `-`. */
export const githubAnchor = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')

const BLOCK = /^```(\w+)\n([\s\S]*?)^```$/gm

export function parseErrorsDoc(md: string): ErrorSection[] {
  const sections: ErrorSection[] = []
  // Every heading of level 2 or 3 ends a section (the page groups codes under `##` headings).
  const chunks = md.split(/^#{2,3} /m).slice(1)
  for (const chunk of chunks) {
    const nl = chunk.indexOf('\n')
    const heading = chunk.slice(0, nl)
    const code = /^`?(DK_[A-Z0-9_]+)`?\s*$/.exec(heading)?.[1]
    if (code === undefined) continue
    const body = chunk.slice(nl + 1)
    const section: ErrorSection = {
      code,
      anchor: githubAnchor(heading),
      body,
      parts: PARTS.filter((p) => body.includes(`**${p}.**`)),
    }
    for (const m of body.matchAll(BLOCK)) {
      const lang = m[1] as string
      const source = (m[2] ?? '').trim()
      if (lang === 'text') section.output = source
      else if (lang === 'ts' || lang === 'tsx') section.code_block = { lang, source }
    }
    sections.push(section)
  }
  return sections
}

/** One diagnostic as the dev console sink printed it (header + body). */
export interface Printed {
  code: string
  text: string
}

type Method = 'groupCollapsed' | 'groupEnd' | 'error' | 'warn' | 'info' | 'log'
const METHODS: Method[] = ['groupCollapsed', 'groupEnd', 'error', 'warn', 'info', 'log']

/**
 * Records the console while an example runs (and keeps the test output quiet). `printed()` pairs
 * each `[DataKable …]` group header with its body, in order.
 */
export function captureConsole(spy: (method: Method, fn: (...args: unknown[]) => void) => void) {
  const calls: { method: Method; args: unknown[] }[] = []
  for (const method of METHODS) spy(method, (...args) => calls.push({ method, args }))
  return {
    printed(): Printed[] {
      const out: Printed[] = []
      for (let i = 0; i < calls.length; i++) {
        const c = calls[i] as { method: Method; args: unknown[] }
        const header = c.args[0]
        if (c.method !== 'groupCollapsed' || typeof header !== 'string') continue
        const code = /\[DataKable [^\]]+\] (DK_[A-Z0-9_]+):/.exec(header)?.[1]
        const body = calls[i + 1]?.args[0]
        if (code === undefined || typeof body !== 'string') continue
        out.push({ code, text: `${header}\n${body}` })
      }
      return out
    },
  }
}

/**
 * What may differ between two runs of one example: the table counter (`table#3`), measured times,
 * and the installed version (`version`, written `<version>` in the docs). Applied to both the docs
 * and the captured output.
 */
export const normalize = (text: string, version: string) =>
  text
    .replace(/table#\d+/g, 'table#1')
    .replace(/\d+\.\d+ ms\b/g, '<n> ms')
    // `@datakable/core@1.2.0`, `…%401.2.0` (an issue link), `this is 1.2.0`.
    .replace(
      new RegExp(`(?<=@|%40|\\s)${version.replace(/\./g, '\\.')}(?![\\d.])`, 'g'),
      '<version>',
    )
    .trim()
