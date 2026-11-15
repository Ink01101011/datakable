import { ExSearch } from 'ex-search'
import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTable } from '../../table/create-table'
import { columnFilters } from '../column-filters'
import { search } from './search'
import { rankHits } from './search-index'

// #96: per-keystroke work DataKable asks of ex-search. With `fuzzyMaxDistance: 0` no fuzzy score
// can pass (distance 0 means equal strings, which the exact / contains tiers already score), so
// splitting every cell into words for a one-word query is work for nothing: the matcher is asked
// for whole-value matching only. The results stay those of word mode. With fuzzy matching on,
// the words of each cell are split once per data array (ex-search's word index, kept per block of
// rows), not per keystroke (#96 a).

type R = { id: number; name: string; city: string }

const columns = [
  { key: 'name' as const, search: 1 },
  { key: 'city' as const, search: 0.5 },
]

const ids = (t: { getRowModel(): { rows: readonly { index: number }[] } }) =>
  t.getRowModel().rows.map((r) => r.index)

type Opts = { threshold?: number; fuzzyMaxDistance?: number; caseSensitive?: boolean }

type T = {
  setSearch(q: string): Promise<unknown>
  setOptions(o: { data: readonly R[] }): void
  setColumnFilter(id: string, filter: unknown): void
  getRowModel(): { rows: readonly { index: number }[] }
}

const table = (data: readonly R[], opts: Opts) =>
  createTable({ data, columns, features: [search(opts)] }) as never as T

/**
 * Code-unit reads (`charCodeAt`) of the given cell texts: ex-search's word tokeniser scans a cell's
 * code units to find its words (1.2.0 called `split(/\s+/)`); whole-value matching of a short
 * query reads none, nor does word matching with a word index already built (2.1.1).
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
    const splits = countSplits(cells)
    await t.setSearch('lopex')
    expect(splits.calls).toBeGreaterThan(0)
    await t.setSearch('lopes')
    expect(ids(t)).toContain(0)
  })

  it('fuzzy matching on: the words are split once per data array, not per keystroke', async () => {
    const t = table(data, { fuzzyMaxDistance: 1 })
    await t.setSearch('lopex')
    const splits = countSplits([...cells, 'bob lovelace'])
    for (const q of ['lopes', 'lop', 'garcia', 'lovelace x', 'lovelac']) {
      await t.setSearch(q)
      // A query with spaces matches whole values, and keeps the words for the next one.
      expect(splits.calls, q).toBe(0)
    }
    expect(ids(t)).toEqual([1])
    // A new data array is a new data version: its words are split again, once.
    const next = data.slice()
    next[3] = { id: 3, name: 'Bob Lovelace', city: 'Lopez Town' }
    t.setOptions({ data: next })
    expect(ids(t)).toEqual([1, 3])
    expect(splits.calls).toBeGreaterThan(0)
    splits.calls = 0
    await t.setSearch('lovlace')
    expect(splits.calls).toBe(0)
    expect(ids(t)).toEqual([1, 3])
  })

  it('fuzzy matching on: a keystroke reads each searched cell once', async () => {
    const reads = { cells: 0 }
    const rows = data.map(({ id, name, city }) => {
      const o = { id } as R
      for (const [k, v] of [
        ['name', name],
        ['city', city],
      ] as const) {
        Object.defineProperty(o, k, {
          enumerable: true,
          get: () => {
            reads.cells++
            return v
          },
        })
      }
      return o
    })
    const CELLS = rows.length * columns.length
    const t = table(rows, { fuzzyMaxDistance: 1 })
    await t.setSearch('lopex')
    // The index scan, the hash pass, and the word index built with the scoring (one read).
    expect(reads.cells).toBe(3 * CELLS)
    for (const q of ['lopes', 'lovelace x', 'lovelac']) {
      reads.cells = 0
      await t.setSearch(q)
      expect(reads.cells, q).toBe(CELLS)
    }
  })

  it('a row changed in place without a new array: no throw; a new array matches like cold', async () => {
    const rows = data.map((r) => ({ ...r }))
    const t = table(rows, { fuzzyMaxDistance: 1 })
    await t.setSearch('lopex')
    // Not supported (DK_DATA_MUTATED): the kept scores and words may be stale until a new array.
    Object.assign(rows[1] as R, { name: 'Ada Lopez Lovelace Garcia' })
    await t.setSearch('lovelac')
    t.setOptions({ data: rows.slice() })
    await t.setSearch('lopes')
    const cold = table(rows, { fuzzyMaxDistance: 1 })
    await cold.setSearch('lopes')
    expect(ids(t)).toEqual(ids(cold))
    expect(ids(t)).toContain(1)
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

describe('search: the kept word index over several blocks of rows (#96 a)', () => {
  // Two searched columns: 4096 rows per block (search-index.ts), so 20k rows are five blocks, the
  // last one partial. Edits land anywhere (block edges included), filters leave blocks partly
  // matched, and the query sequences mix one-word fuzzy queries (word index), queries with spaces
  // (whole values), extensions (narrowed with fuzzy matching off) and new data arrays (S95).
  type Q = R & { n: number }
  const make = (data: readonly Q[], opts: Opts) =>
    createTable({
      data,
      columns: [...columns, { key: 'n' as const, search: 0 }],
      features: [columnFilters(), search(opts)],
    }) as never as T
  const WORDS = ['garcia', 'lopez', 'Lopes', 'ada', 'Lovelace', 'Bob', 'chiang', 'mai', 'São']
  const rowsOf = (count: number, seed: number): Q[] =>
    Array.from({ length: count }, (_, id) => {
      const x = (id * 2654435761 + seed * 40503) >>> 0
      const w = (k: number) => WORDS[(x >>> k) % WORDS.length] as string
      return {
        id,
        name: x % 3 ? `${w(1)} ${w(5)}` : w(9),
        city: x % 5 ? `${w(13)}  ${w(17)} ${x % 97}` : w(21),
        n: x % 4,
      }
    })
  const edges = [0, 4095, 4096, 8191, 8192, 12288, 16383, 16384, 19999]

  it('every block splits its words once; later one-word keystrokes split none', async () => {
    const data = rowsOf(20_000, 7)
    const t = make(data, {})
    const splits = countSplits(data.flatMap((r) => [r.name, r.city]).map((v) => v.toLowerCase()))
    await t.setSearch('lopex')
    expect(splits.calls).toBeGreaterThan(0)
    const first = ids(t)
    expect(first.length).toBeGreaterThan(0)
    expect(first.some((i) => i >= 16_384)).toBe(true)
    for (const q of ['lovelase', 'gracia', 'chang']) {
      splits.calls = 0
      await t.setSearch(q)
      expect(splits.calls, q).toBe(0)
      expect(ids(t).length, q).toBeGreaterThan(0)
    }
  })

  it('randomised: incremental + narrowed + kept word index equal a cold search', async () => {
    const word = fc.constantFrom(
      'lopex',
      'lopes',
      'lovelase',
      'gracia',
      'ada',
      'chang',
      'sao',
      'bob',
    )
    const step = fc.oneof(
      { weight: 3, arbitrary: fc.record({ op: fc.constant('query' as const), q: word }) },
      {
        weight: 1,
        arbitrary: fc.record({
          op: fc.constant('spaced' as const),
          q: fc.tuple(word, word).map(([a, b]) => ` ${a} ${b}`),
        }),
      },
      {
        weight: 2,
        arbitrary: fc.record({
          op: fc.constant('extend' as const),
          add: fc.constantFrom('z', 'a', ' ', 'é'),
        }),
      },
      {
        weight: 2,
        arbitrary: fc.record({
          op: fc.constant('edit' as const),
          at: fc.oneof(fc.constantFrom(...edges), fc.nat({ max: 19_999 })),
          name: word,
          inPlace: fc.boolean(),
        }),
      },
      {
        weight: 1,
        arbitrary: fc.record({ op: fc.constant('insert' as const), at: fc.constantFrom(...edges) }),
      },
      { weight: 1, arbitrary: fc.record({ op: fc.constant('filter' as const), max: fc.nat(3) }) },
    )
    await fc.assert(
      fc.asyncProperty(
        fc.nat(),
        word,
        fc.array(step, { minLength: 1, maxLength: 6 }),
        fc.record({
          threshold: fc.constantFrom(0.3, 0.5),
          fuzzyMaxDistance: fc.constantFrom(0, 1, 3),
          caseSensitive: fc.boolean(),
        }),
        async (seed, q0, steps, opts) => {
          let data = rowsOf(20_000, seed)
          let q: string = q0
          let filter: unknown
          const t = make(data, opts)
          await t.setSearch(q)
          for (const e of steps) {
            if (e.op === 'query' || e.op === 'spaced') q = e.q
            else if (e.op === 'extend') q += e.add
            else if (e.op === 'filter') {
              filter = e.max === 3 ? undefined : { type: 'range', value: { max: e.max } }
              t.setColumnFilter('n', filter)
            } else {
              const at = Math.min(e.at, data.length - 1)
              const row = { id: -1 - at, name: 'lopez lovelace', city: 'x', n: 1 }
              if (e.op === 'edit' && e.inPlace) Object.assign(data[at] as Q, { name: e.name })
              data = data.slice()
              if (e.op === 'edit' && !e.inPlace) data[at] = { ...row, name: e.name }
              if (e.op === 'insert') data.splice(at, 0, row)
              t.setOptions({ data })
            }
            await t.setSearch(q)
            const c = make(data, opts)
            if (filter) c.setColumnFilter('n', filter)
            await c.setSearch(q)
            expect(ids(t), `${e.op} "${q}"`).toEqual(ids(c))
          }
        },
      ),
      { numRuns: 8 },
    )
  })
})
