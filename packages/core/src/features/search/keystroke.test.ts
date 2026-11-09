import { ExSearch } from 'ex-search'
import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTable } from '../../table/create-table'
import { search } from './search'
import { rankHits } from './search-index'

// #96: per-keystroke work DataKable asks of ex-search. With `fuzzyMaxDistance: 0` no fuzzy score
// can pass (distance 0 means equal strings, which the exact / contains tiers already score), so
// splitting every cell into words for a one-word query is work for nothing: the matcher is asked
// for whole-value matching only. The results stay those of word mode.

type R = { id: number; name: string; city: string }

const columns = [
  { key: 'name' as const, search: 1 },
  { key: 'city' as const, search: 0.5 },
]

const ids = (t: { getRowModel(): { rows: readonly { index: number }[] } }) =>
  t.getRowModel().rows.map((r) => r.index)

type Opts = { threshold?: number; fuzzyMaxDistance?: number; caseSensitive?: boolean }

const table = (data: readonly R[], opts: Opts) =>
  createTable({ data, columns, features: [search(opts)] }) as never as {
    setSearch(q: string): Promise<unknown>
    getRowModel(): { rows: readonly { index: number }[] }
  }

/**
 * Code-unit reads (`charCodeAt`) of the given cell texts: ex-search 1.2.1's word tokeniser scans a
 * cell's code units to find its words (1.2.0 called `split(/\s+/)`); whole-value matching of a
 * short query reads none.
 */
function countSplits(cells: readonly string[]) {
  const texts = new Set(cells)
  const counted = { calls: 0 }
  const charCodeAt = String.prototype.charCodeAt
  vi.spyOn(String.prototype, 'charCodeAt').mockImplementation(function (this: string, i) {
    if (texts.has(String(this))) counted.calls++
    return charCodeAt.call(this, i)
  })
  return counted
}

afterEach(() => {
  vi.restoreAllMocks()
})

const data: R[] = [
  { id: 0, name: 'Garcia Lopez', city: 'Chiang Mai' },
  { id: 1, name: 'Ada Lovelace', city: 'London' },
  { id: 2, name: 'lopes', city: 'São Paulo' },
  { id: 3, name: 'Bob', city: 'Lopez Town' },
]
/** The cell texts as ex-search reads them (folded). */
const cells = data.flatMap((r) => [r.name, r.city]).map((v) => v.toLowerCase())

describe('search: word splitting per keystroke (#96)', () => {
  it('fuzzyMaxDistance 0: a one-word query splits no cell into words', async () => {
    const t = table(data, { fuzzyMaxDistance: 0 })
    await t.setSearch('lopez')
    const splits = countSplits(cells)
    await t.setSearch('lope')
    expect(splits.calls).toBe(0)
    expect(ids(t)).toEqual([2, 0, 3])
  })

  it('fuzzy matching on: a one-word query still matches each word of a cell', async () => {
    const t = table(data, { fuzzyMaxDistance: 1 })
    await t.setSearch('lopex')
    const splits = countSplits(cells)
    await t.setSearch('lopes')
    expect(splits.calls).toBeGreaterThan(0)
    expect(ids(t)).toContain(0)
  })

  it('randomised: fuzzyMaxDistance 0 ranks like word-mode matching', async () => {
    const word = fc.constantFrom('ada', 'Ada', 'adam', 'lopez', 'Σ', 'ΟΔΟΣ', 'naïve', 'naïve')
    const sep = fc.constantFrom(' ', '  ', '\t', ' ', '　', '')
    const text = fc
      .array(fc.tuple(word, sep), { maxLength: 4 })
      .map((p) => p.map(([w, s]) => w + s).join(''))
    const row = fc.record({ name: text, city: text })
    const query = fc.oneof(
      word,
      fc.tuple(word, word).map(([a, b]) => `${a} ${b}`),
    )
    await fc.assert(
      fc.asyncProperty(
        fc.array(row, { maxLength: 30 }),
        fc.array(query, { minLength: 1, maxLength: 5 }),
        fc.constantFrom(0, 0.3, 0.6, 0.8),
        fc.boolean(),
        async (rows, queries, threshold, caseSensitive) => {
          const d = rows.map((r, id) => ({ id, ...r }))
          const t = table(d, { threshold, fuzzyMaxDistance: 0, caseSensitive })
          const fold = (v: string) => {
            const n = v.normalize('NFC')
            return caseSensitive ? n : n.toLowerCase()
          }
          const items = d.map((r, i) => ({ i, c0: fold(r.name), c1: fold(r.city) }))
          for (const q0 of queries) {
            const q = q0.trim()
            if (q === '') continue
            await t.setSearch(q)
            // The word-mode reference, as DataKable asked ex-search before #96.
            const ref = new ExSearch({
              keys: [
                { name: 'c0', weight: 1 },
                { name: 'c1', weight: 0.5 },
              ],
              threshold,
              fuzzyMaxDistance: 0,
              caseSensitive: true,
              sortAlgorithm: 'tim',
              fuzzyMode: /\s/.test(q) ? 'value' : 'word',
            })
            ref.setData(items)
            const want = rankHits(ref.search(fold(q)) as never)
            expect(ids(t)).toEqual([...want])
          }
        },
      ),
      { numRuns: 300 },
    )
  })
})
