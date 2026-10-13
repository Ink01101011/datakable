// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fences } from './docs-check'
import {
  createTable,
  type Diagnostic,
  pagination,
  type StandardSchemaV1,
  search,
  VERSION,
  withFetcher,
  withSchema,
  withSearchFn,
} from './index'

/**
 * The production-build pages of `docs/how-to-fix/` (D3, job datakable-docs-v1), in a production
 * build of core (`DEV` false, as `options.prod.test.ts` does): an unwrapped `schema` / `fetcher` /
 * `searchFn` still throws, and diagnostics lose their text until `datakable/messages` is imported.
 */
vi.mock('../../core/src/diagnostics/env', () => ({ DEV: false }))

const fs = (await import('node:fs' as string)) as {
  readFileSync(path: URL, encoding: 'utf8'): string
}
const textBlocks = (page: string) =>
  fences(fs.readFileSync(new URL(`../../../docs/how-to-fix/${page}`, import.meta.url), 'utf8'))
    .filter((f) => f.lang === 'text')
    .map((f) => f.code)

const ex = './docs-examples/how-to-fix'
const users = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Grace' },
]
const schema: StandardSchemaV1<unknown, { id: number; name: string }> = {
  '~standard': { version: 1, vendor: 'test', validate: (v) => ({ value: v as never }) },
}
/** The `code` of what `create` throws. */
const thrown = (create: () => unknown) => {
  try {
    create()
  } catch (e) {
    return { name: (e as Error).name, code: (e as { code?: string }).code }
  }
  return undefined
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('unwrapped-schema-fetcher-or-searchfn.md (production build)', () => {
  const config = { name: 'DatakableConfigError', code: 'DK_INVALID_OPTION' }

  it('an unwrapped schema, fetcher or searchFn throws DK_INVALID_OPTION', () => {
    const features = [pagination({ mode: 'server' })]
    expect(thrown(() => createTable({ data: users, schema: schema as never }))).toEqual(config)
    expect(
      thrown(() => createTable({ features, fetcher: (async () => ({ rows: [] })) as never })),
    ).toEqual(config)
    expect(
      thrown(() =>
        createTable({ data: users, features: [search({ searchFn: (() => []) as never })] }),
      ),
    ).toEqual(config)
  })

  it('wrapped, each one works', async () => {
    expect(
      createTable({ data: users, rowKey: 'id', schema: withSchema(schema) }).getRowModel().rows,
    ).toHaveLength(2)
    const fetched = createTable({
      rowKey: 'id',
      features: [pagination({ mode: 'server' })],
      fetcher: withFetcher(async () => ({ rows: users, rowCount: 2 })),
    })
    await vi.waitFor(() => expect(fetched.getRowModel().rows).toHaveLength(2))
    const searched = createTable({
      data: users,
      rowKey: 'id',
      features: [
        search<(typeof users)[number]>({
          searchFn: withSearchFn(({ query, rows }) => rows.filter((u) => u.name.startsWith(query))),
        }),
      ],
    })
    await searched.setSearch('Gr')
    expect(searched.getRowModel().rows.map((r) => r.original.name)).toEqual(['Grace'])
  })
})

describe('diagnostics-without-text-in-production.md (production build)', () => {
  const page = 'diagnostics-without-text-in-production.md'

  it('a production diagnostic keeps code, where and docs, and prints one line', async () => {
    const errors: string[] = []
    vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a.map(String).join(' ')))
    const logged: [string, Record<string, unknown>][] = []
    vi.stubGlobal('logger', {
      error: (m: string, data: Record<string, unknown>) => logged.push([m, data]),
    })
    const { table } = await import(`${ex}/diagnostics-without-text-in-production/1-report`)
    await vi.waitFor(() => expect(table.getRowModel().status).toBe('error'))
    const [line] = textBlocks(page)
    const versioned = (s: string) =>
      s.replace(`v=${VERSION}&`, 'v=<version>&').replace(/table#\d+/, 'table#1')
    expect(errors.map(versioned)).toEqual([line])
    expect(logged[0]?.[0]).toBe('DK_FETCH_FAILED')
    expect(logged[0]?.[1]).toMatchObject({
      code: 'DK_FETCH_FAILED',
      problem: '',
      where: { kind: 'option', path: 'fetcher' },
    })
  })

  it('after `import "datakable/messages"`, the text is there', async () => {
    const seen: Diagnostic[] = []
    const fail = () =>
      createTable({
        features: [pagination({ mode: 'server' })],
        onDiagnostic: (d) => seen.push(d),
        fetcher: withFetcher(async () => {
          throw new TypeError('Failed to fetch')
        }),
      })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const before = fail()
    await vi.waitFor(() => expect(before.getRowModel().status).toBe('error'))
    expect([seen[0]?.problem, seen[0]?.fix]).toEqual(['', []])
    await import(`${ex}/diagnostics-without-text-in-production/2-messages`)
    const after = fail()
    await vi.waitFor(() => expect(after.getRowModel().status).toBe('error'))
    expect(seen[1]?.problem).toBe('fetcher rejected or threw TypeError')
    expect(seen[1]?.fix.length).toBeGreaterThan(0)
  })
})
