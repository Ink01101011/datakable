import { describe, expect, it } from 'vitest'
import { createTable } from '../../table/create-table'
import reference from './ex-search-1.2.1.ref.json'
import { type SearchOptions, search } from './search'

// #123: ex-search 1.2.1 → 2.1.1. ex-search 2.0 trims the query, stops matching objects and arrays
// as text, skips `null` rows and throws on a non-finite weight or threshold. DataKable hands it its
// own projected items `{ i, c0, c1, … }` of folded strings (search-index.ts), trims the query
// itself and passes only weights > 0, so none of this may show: the rows and their order for the
// same data, options and keystrokes are those recorded with ex-search 1.2.1
// (`ex-search-1.2.1.ref.json`). The cases cover queries with leading / trailing spaces,
// `null` / `undefined` cells, and object / array cells with and without a `search` weight.
//
// The reference is written by this file, run against ex-search 1.2.1, with
// `DK_WRITE_EX_SEARCH_REF=<path>`; it is data, never regenerated against 2.x.

type R = {
  id: number
  name: string | null | undefined
  city: string
  n: number | null | undefined
  tags: string[]
  address: { street: string; zip: string } | null
}

/** mulberry32: the same rows on every run. */
function prng(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WORDS = [
  'Ada',
  'ada',
  'Lovelace',
  'lopez',
  'Lopes',
  'garcia',
  'ΟΔΟΣ',
  'Σ',
  'naïve',
  'naïve',
  'café',
  'café',
  'Zürich',
  'name',
  '12',
  'object',
  'null',
]
const CITIES = ['Bangkok', 'Chiang Mai', '  Khon Kaen ', 'São Paulo', 'London', 'lopez town']

function rows(count: number): R[] {
  const rnd = prng(96)
  const pick = <V>(xs: readonly V[]) => xs[Math.floor(rnd() * xs.length)] as V
  return Array.from({ length: count }, (_, id) => {
    const k = rnd()
    const name =
      k < 0.08
        ? null
        : k < 0.14
          ? undefined
          : k < 0.2
            ? ` ${pick(WORDS)} `
            : Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(WORDS)).join(
                rnd() < 0.2 ? '  ' : ' ',
              )
    return {
      id,
      name,
      city: pick(CITIES),
      n: rnd() < 0.15 ? null : rnd() < 0.1 ? undefined : Math.floor(rnd() * 200),
      tags: rnd() < 0.3 ? [] : [pick(WORDS), pick(WORDS)],
      address: rnd() < 0.2 ? null : { street: `${pick(WORDS)} road`, zip: String(id % 13) },
    }
  })
}

const DATA = rows(64)

/** Typed one after another on one table (keystrokes, incremental and narrowed paths included). */
const QUERIES = [
  'ada',
  '  ada',
  'ada ',
  ' ada lovelace ',
  'lop',
  'lope',
  'lopez',
  'lopex',
  ' lopez town',
  'ΟΔΟΣ',
  'οδοσ',
  'σ',
  'naïve',
  'naïve',
  'cafe',
  'café',
  'café',
  'zurich',
  'zürich ',
  'name 12',
  '12',
  '1',
  'object',
  '[object',
  '[object object]',
  'null',
  'undefined',
  'road',
  'lovelace road',
  'bangkok',
  '  ',
  'kok',
]

/**
 * Columns: zero-config, declared weights without the object / array columns, and with them. The
 * object column has no `format` (the types ask for one; untyped callers can leave it out).
 */
const COLUMNS: Record<string, readonly object[]> = {
  zero: [
    { key: 'name' as const },
    { key: 'city' as const },
    { key: 'n' as const },
    { key: 'tags' as const },
    { key: 'address' as const },
  ],
  weighted: [
    { key: 'name' as const, search: 1 },
    { key: 'city' as const, search: 0.5 },
    { key: 'n' as const, search: 0.8 },
    { key: 'tags' as const },
    { key: 'address' as const },
  ],
  objects: [
    { key: 'name' as const, search: 1 },
    { key: 'city' as const, search: 0.4 },
    { key: 'n' as const },
    { key: 'tags' as const, search: 0.7 },
    { key: 'address' as const, search: 0.6 },
  ],
}

const OPTIONS: Record<string, SearchOptions> = {
  default: {},
  fuzzy0: { fuzzyMaxDistance: 0 },
  fuzzy1: { fuzzyMaxDistance: 1 },
  caseSensitive: { caseSensitive: true },
  strict: { threshold: 0.7 },
  loose: { threshold: 0, fuzzyMaxDistance: 2 },
}

type T = {
  setSearch(q: string): Promise<unknown>
  getRowModel(): { rows: readonly { index: number }[] }
}

/** Every case's hits in order, as `"<columns>/<options>"` → one id list per query. */
async function run(): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {}
  for (const [c, columns] of Object.entries(COLUMNS)) {
    for (const [o, opts] of Object.entries(OPTIONS)) {
      const t = createTable({
        data: DATA,
        columns: columns as never,
        features: [search(opts)],
        onDiagnostic() {},
      }) as never as T
      const hits: string[] = []
      for (const q of QUERIES) {
        await t.setSearch(q)
        hits.push(
          t
            .getRowModel()
            .rows.map((r) => r.index)
            .join(),
        )
      }
      out[`${c}/${o}`] = hits
    }
  }
  return out
}

describe('ex-search 2.x upgrade: the same rows in the same order as 1.2.1 (#123)', () => {
  it('every case matches the 1.2.1 reference', async () => {
    const got = await run()
    // No @types/node here: declare just what is used (as feature/minified-bundle.test.ts).
    const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
      .process.env
    const out = env.DK_WRITE_EX_SEARCH_REF
    if (out) {
      const fs = (await import('node:fs' as string)) as {
        writeFileSync(path: string, text: string): void
      }
      fs.writeFileSync(out, `${JSON.stringify({ queries: QUERIES, hits: got }, null, 2)}\n`)
    }
    expect(reference.queries).toEqual(QUERIES)
    expect(Object.keys(got)).toEqual(Object.keys(reference.hits))
    for (const [k, hits] of Object.entries(got)) {
      const ref = (reference.hits as Record<string, string[]>)[k] as string[]
      for (let j = 0; j < QUERIES.length; j++) {
        expect(hits[j], `${k} "${QUERIES[j]}"`).toBe(ref[j])
      }
    }
    // Not vacuous: most queries hit something, and the cases differ from one another.
    const all = Object.values(got).flat()
    expect(all.filter((h) => h !== '').length).toBeGreaterThan(all.length / 2)
    expect(new Set(Object.values(got).map((h) => h.join('|'))).size).toBeGreaterThan(10)
  })

  // The one difference found: ex-search 2.x rejects a non-finite weight (RangeError). A column
  // `search: Infinity` ranked rows with infinite scores on 1.2.1 (rows 0 and 1 here); on 2.x the
  // search step fails, is reported, and keeps every row. Not a valid weight; the same holds for a
  // threshold outside 0–1 in production (development rejects it: DK_INVALID_OPTION).
  it('a non-finite column weight: the search step fails and is reported (DK_FEATURE_FAILED)', async () => {
    const codes: string[] = []
    const t = createTable({
      data: [
        { id: 0, name: 'ada lovelace', city: 'london' },
        { id: 1, name: 'bob', city: 'ada town' },
        { id: 2, name: 'x', city: 'y' },
      ],
      columns: [
        { key: 'name', search: Number.POSITIVE_INFINITY },
        { key: 'city', search: 1 },
      ],
      features: [search()],
      onDiagnostic: (d) => {
        codes.push(d.code)
      },
    })
    await t.setSearch('ada')
    expect(codes).toContain('DK_FEATURE_FAILED')
    expect(ids(t as never)).toEqual([0, 1, 2])
  })

  it('every keystroke matches a cold table for the same query', async () => {
    for (const [c, columns] of Object.entries(COLUMNS)) {
      for (const [o, opts] of Object.entries(OPTIONS)) {
        const make = () =>
          createTable({
            data: DATA,
            columns: columns as never,
            features: [search(opts)],
            onDiagnostic() {},
          }) as never as T
        const typing = make()
        for (const q of QUERIES) {
          await typing.setSearch(q)
          const cold = make()
          await cold.setSearch(q)
          expect(ids(typing), `${c}/${o} "${q}"`).toEqual(ids(cold))
        }
      }
    }
  })
})

const ids = (t: T) => t.getRowModel().rows.map((r) => r.index)
