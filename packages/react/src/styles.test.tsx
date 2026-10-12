import { type FetchResult, pagination, search, sorting } from '@datakable/core'
import { withSchema } from '@datakable/core/schema'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { makeSchema, userCheck } from '../../core/src/ingest/test-schemas'
import { DataTable } from './data-table'
import { useDataTable } from './use-data-table'

// The optional stylesheet (§10): styles <DataTable /> only through the hooks it renders.

// No @types/node here: declare just what is read. Node's URL (happy-dom replaces the global).
type FileUrl = { readonly href: string }
const { readFileSync, readdirSync } = (await import('node:fs' as string)) as {
  readFileSync(path: FileUrl, encoding: 'utf8'): string
  readdirSync(path: FileUrl, options: { recursive: true }): string[]
}
const { URL: NodeUrl } = (await import('node:url' as string)) as {
  URL: new (path: string, base: string | FileUrl) => FileUrl
}
const packages = new NodeUrl('../../', import.meta.url)
const css = readFileSync(new NodeUrl('./styles.css', import.meta.url), 'utf8')
const code = css.replace(/\/\*[\s\S]*?\*\//g, '')

let consoleError: MockInstance
let consoleWarn: MockInstance
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  consoleError.mockRestore()
  consoleWarn.mockRestore()
})

type User = { id: number; name: string; age: number }
const raw = [
  { id: 1, name: 'Mali', age: 31 },
  { id: 2, name: 'Anan', age: 'not a number' },
  { id: 3, name: 'Ploy', age: 40 },
]

function Hooked(props: { options: Record<string, unknown> }) {
  return <DataTable table={useDataTable(props.options as never) as never} />
}

/** `name` and `name=value` of every data-* / aria-* attribute rendered under `el`. */
function collect(el: Element, into: Set<string>) {
  for (const node of [el, ...el.querySelectorAll('*')]) {
    for (const a of node.attributes) {
      if (!a.name.startsWith('data-') && !a.name.startsWith('aria-')) continue
      into.add(a.name)
      into.add(`${a.name}=${a.value}`)
    }
  }
}

/** Renders every state <DataTable /> has and returns the hooks seen. */
async function renderedHooks(): Promise<Set<string>> {
  const seen = new Set<string>()

  // Rows: sort, search (pending spinner), pagination, flagged rows and cells.
  const rows = render(
    <Hooked
      options={{
        data: raw,
        schema: withSchema(makeSchema(userCheck)),
        invalidRows: 'flag',
        features: [
          sorting(),
          search({ typing: { strategy: 'debounce' } }),
          pagination({ pageSize: 2 }),
        ],
      }}
    />,
  )
  collect(rows.container, seen)
  fireEvent.click(within(screen.getByRole('columnheader', { name: /name/ })).getByRole('button'))
  collect(rows.container, seen)
  fireEvent.click(within(screen.getByRole('columnheader', { name: /name/ })).getByRole('button'))
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zz' } })
  collect(rows.container, seen)
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
  rows.unmount()

  // Loading, load error, empty, refresh (fetching / error) over stale rows.
  const calls: { resolve: (r: FetchResult<User>) => void; reject: (e: unknown) => void }[] = []
  const fetcher = () =>
    new Promise<FetchResult<User>>((resolve, reject) => calls.push({ resolve, reject }))
  const remote = render(<Hooked options={{ fetcher, features: [sorting({ mode: 'server' })] }} />)
  collect(remote.container, seen)
  await act(async () => calls[0]?.reject(new Error('boom')))
  collect(remote.container, seen)
  await act(async () => {
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }))
  })
  await act(async () => calls[1]?.resolve({ rows: [], rowCount: 0 }))
  collect(remote.container, seen)
  remote.unmount()

  const stale = render(
    <Hooked
      options={{
        fetcher,
        columns: [{ key: 'name' }],
        features: [sorting({ mode: 'server' })],
      }}
    />,
  )
  await act(async () => calls.at(-1)?.resolve({ rows: raw as User[], rowCount: 3 }))
  fireEvent.click(within(screen.getByRole('columnheader', { name: /name/ })).getByRole('button'))
  collect(stale.container, seen)
  await act(async () => calls.at(-1)?.reject(new Error('boom')))
  collect(stale.container, seen)
  stale.unmount()
  return seen
}

/** Every `[name]` / `[name="value"]` in the stylesheet, as `name` / `name=value`. */
function selectorHooks(): string[] {
  const out = new Set<string>()
  for (const m of code.matchAll(/\[([a-z-]+)(?:="([^"]*)")?\]/g)) {
    out.add(m[2] === undefined ? (m[1] as string) : `${m[1]}=${m[2]}`)
  }
  return [...out].sort()
}

describe('styles.css', () => {
  it('styles <DataTable /> only through hooks it actually renders', async () => {
    const seen = await renderedHooks()
    const used = selectorHooks()
    // The stylesheet covers every state the spec names.
    for (const hook of [
      'data-datakable',
      'data-status=error',
      'data-initial-load=true',
      'aria-busy=true',
      'data-dk-state=loading',
      'data-dk-state',
      'data-dk-state=error',
      'data-dk-refresh',
      'aria-sort=ascending',
      'aria-sort=descending',
      'data-dk-sort-indicator',
      'data-dk-search',
      'data-dk-spinner',
      'data-dk-pagination',
      'data-invalid=true',
      'data-dk-invalid-marker',
    ]) {
      expect(used, hook).toContain(hook)
    }
    expect(used.filter((h) => !seen.has(h))).toEqual([])
  })

  it('has zero specificity: every rule is wrapped in :where()', () => {
    const preludes = code
      .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '')
      .match(/[^{};]+(?=\{)/g)
      ?.map((s) => s.trim())
      .filter((s) => !s.startsWith('@'))
    expect(preludes?.length).toBeGreaterThan(10)
    for (const p of preludes ?? []) {
      for (const sel of p.split(/,(?![^(]*\))/)) expect(sel.trim(), p).toMatch(/^:where\(.*\)$/s)
    }
  })

  it('themes through --dk-* custom properties, with dark and reduced-motion variants', () => {
    expect(code).toMatch(/--dk-[a-z-]+\s*:/)
    expect(code).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/)
    expect(code).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  })

  it('happy-dom applies it to the rendered table', () => {
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)
    try {
      const { container } = render(<DataTable data={[{ id: 1 }]} />)
      const table = container.querySelector('table') as HTMLTableElement
      expect(getComputedStyle(table).borderCollapse).toBe('collapse')
    } finally {
      style.remove()
    }
  })
})

describe('styles.css packaging (§12)', () => {
  const pkg = (name: string) =>
    JSON.parse(readFileSync(new NodeUrl(`${name}/package.json`, packages), 'utf8')) as {
      exports: Record<string, unknown>
      sideEffects: unknown
    }

  it.each(['react', 'datakable'])('%s exports ./styles.css and lists it in sideEffects', (name) => {
    const p = pkg(name)
    expect(p.exports['./styles.css']).toBe('./dist/styles.css')
    expect(p.sideEffects).toEqual(expect.arrayContaining(['./dist/styles.css']))
    // The JS stays side-effect free (messages excepted).
    for (const s of p.sideEffects as string[]) expect(s).toMatch(/messages\.c?js$|styles\.css$/)
  })

  it('no JS source imports CSS (a JS-only import pulls in none)', () => {
    for (const name of ['react', 'datakable']) {
      const dir = new NodeUrl(`${name}/src/`, packages)
      for (const file of readdirSync(dir, { recursive: true })) {
        if (!/\.tsx?$/.test(file) || file.includes('.test')) continue
        expect(readFileSync(new NodeUrl(file, dir), 'utf8'), file).not.toMatch(
          /import\s+['"][^'"]*\.css/,
        )
      }
    }
  })
})
