// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  anchors,
  brokenLinks,
  githubSlug,
  links,
  type RepoFile,
  resolveLink,
  type Tree,
  unreachable,
} from './docs-check'
import { docsPages, existsInRepo, READMES, readRepo } from './docs-files'

/**
 * Docs links resolve (V1, job datakable-docs-v1): every relative link in `docs/**` (not
 * `docs/superpowers/`) and the four READMEs points at an existing file or folder, and its `#anchor`
 * at a heading of the target page (GitHub's slug rules). Links to this repository on GitHub
 * (`https://github.com/Ink01101011/datakable/blob/main/…`, used by the package READMEs because npm
 * shows them) are checked against the working tree the same way. Every docs page is reachable from
 * `docs/README.md`.
 */

const tree: Tree = { exists: existsInRepo, read: readRepo }

describe('docs links', () => {
  const pages = docsPages()
  const readmes = READMES.map((path) => ({ path, text: tree.read(path) }))

  it('every relative link in the docs and the READMEs resolves, down to the heading', () => {
    expect(brokenLinks([...pages, ...readmes], tree)).toEqual([])
  })

  it('every docs page is reachable from docs/README.md', () => {
    expect(unreachable(pages)).toEqual([])
  })

  it('the root README and each package README link the docs hub', () => {
    for (const readme of readmes) {
      const hub = links(readme.text)
        .map((l) => resolveLink(readme.path, l.target)?.path)
        .some((p) => p === 'docs/README.md' || p === 'docs')
      expect(hub, readme.path).toBe(true)
    }
  })
})

describe('the link checker (on fixtures)', () => {
  const files: Record<string, string> = {
    'docs/README.md': [
      '# Docs',
      '',
      '## Start here',
      '',
      '[use](how-to-use/README.md) [fix](how-to-fix/README.md#common-errors)',
      '[bad](how-to-use/nope.md) [bad anchor](how-to-fix/README.md#nope) [self](#start-here)',
      '[site](https://example.com) [gh](https://github.com/Ink01101011/datakable/blob/main/docs/x.md)',
      '`[in code](missing.md)`',
      '',
      '```md',
      '[in a block](missing.md)',
      '```',
      '',
      '[ref]: ../packages/core/src/index.ts#L10',
    ].join('\n'),
    'docs/how-to-use/README.md': '# Use\n\n[up](../README.md)\n',
    'docs/how-to-fix/README.md': '# Fix\n\n## Common errors\n\n## Common errors\n',
    'docs/orphan.md': '# Orphan\n',
    'packages/core/src/index.ts': '',
  }
  const fixtureTree: Tree = {
    exists: (p) => p in files || Object.keys(files).some((f) => f.startsWith(`${p}/`)),
    read: (p) => files[p] ?? '',
  }
  const pages: RepoFile[] = Object.entries(files)
    .filter(([p]) => p.endsWith('.md'))
    .map(([path, text]) => ({ path, text }))

  it('reports missing files and anchors, and nothing in code or on other sites', () => {
    expect(brokenLinks(pages, fixtureTree)).toEqual([
      'docs/README.md:6 → how-to-use/nope.md (no file docs/how-to-use/nope.md)',
      'docs/README.md:6 → how-to-fix/README.md#nope (no heading #nope in docs/how-to-fix/README.md)',
      'docs/README.md:7 → https://github.com/Ink01101011/datakable/blob/main/docs/x.md (no file docs/x.md)',
    ])
  })

  it('reports pages the hub does not reach', () => {
    expect(unreachable(pages)).toEqual(['docs/orphan.md'])
  })

  it('resolves relative, root-climbing and GitHub links', () => {
    expect(resolveLink('docs/a/b.md', '../c.md#x')).toEqual({ path: 'docs/c.md', anchor: 'x' })
    expect(resolveLink('docs/b.md', '#x')).toEqual({ path: 'docs/b.md', anchor: 'x' })
    expect(resolveLink('README.md', '../x.md')).toEqual({ path: null })
    expect(resolveLink('README.md', 'docs/my%20page.md')).toEqual({ path: 'docs/my page.md' })
    expect(
      resolveLink('x.md', 'https://github.com/Ink01101011/datakable/tree/main/packages/core'),
    ).toEqual({ path: 'packages/core' })
    expect(resolveLink('x.md', 'mailto:a@b.c')).toBeUndefined()
  })

  it("follows GitHub's slug rules", () => {
    expect(githubSlug('1. Typo in `key`')).toBe('1-typo-in-key')
    expect(githubSlug('`DK_DUPLICATE_ROW_KEY`')).toBe('dk_duplicate_row_key')
    expect(githubSlug('Debugging tools: `explain()` and `explainRow()`')).toBe(
      'debugging-tools-explain-and-explainrow',
    )
    expect(githubSlug('See [the spec](x.md) — §9.3')).toBe('see-the-spec--93')
    expect([
      ...anchors('# A\n## A\n### A\n```\n# not a heading\n```\n<a id="custom"></a>'),
    ]).toEqual(['a', 'a-1', 'a-2', 'custom'])
  })
})
