import { ExSearch } from 'ex-search'
import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTable } from '../../table/create-table'
import { columnFilters } from '../column-filters'
import { search } from './search'

// #96 (c): a query that provably keeps no row the previous query dropped (ex-search's `canNarrow`:
// fuzzy matching off, the previous query inside the new one, threshold and weights permitting) is
// matched only within the previous hits. The check runs on the strings ex-search scores (trimmed,
// NFC, case-folded by DataKable), so raw-prefix traps (Greek final sigma, NFD accents) are not
// narrowed. Rows a filter hid from the previous match are matched when they come back.

type R = { id: number; name: string; city: string; n: number }

type Opts = { threshold?: number; fuzzyMaxDistance?: number; caseSensitive?: boolean }

type T = {
  setSearch(q: string): Promise<unknown>
  setOptions(o: { data: readonly R[] }): void
  setColumnFilter(id: string, filter: unknown): void
  getRowModel(): { rows: readonly { index: number }[] }
}

const ids = (t: T) => t.getRowModel().rows.map((r) => r.index)

const table = (data: readonly R[], opts: Opts, weights: readonly [number, number] = [1, 0.5]) =>
  createTable({
    data,
    columns: [
      { key: 'name', search: weights[0] },
      { key: 'city', search: weights[1] },
      { key: 'n', search: 0 },
    ],
    features: [columnFilters(), search(opts)],
  }) as never as T

/**
 * Rows ex-search scores: each `search` call scores the rows its view shows (or its `within`
 * rows). Counted from the start of each test, so every engine's view is known.
 */
const scored = { rows: 0 }
beforeEach(() => {
  scored.rows = 0
  const views = new WeakMap<object, { length: number }>()
  const setData = ExSearch.prototype.setData
  vi.spyOn(ExSearch.prototype, 'setData').mockImplementation(function (this: object, items) {
    views.set(this, items as unknown as { length: number })
    return setData.call(this as never, items)
  })
  const run = ExSearch.prototype.search
  vi.spyOn(ExSearch.prototype, 'search').mockImplementation(function (this: object, q, options) {
    scored.rows += options?.within?.length ?? views.get(this)?.length ?? Number.NaN
    return run.call(this as never, q, options)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const N = 1000
const words = ['alpha', 'bravo', 'ada', 'adam', 'Adams', 'Zürich', 'naïve', 'ΟΔΟΣ', 'café']
const make = (n: number): R[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i,
    name: `${words[i % 9]} ${words[(i * 7) % 9]}`,
    city: words[(i * 5) % 9] as string,
    n: i % 10,
  }))

const cold = async (data: readonly R[], q: string, opts: Opts, filter?: unknown) => {
  const t = table(data, opts)
  if (filter) t.setColumnFilter('n', filter)
  await t.setSearch(q)
  return ids(t)
}

describe('search: a longer query matches only the previous hits (#96 c)', () => {
  it('fuzzy matching off: each extension scores only the previous hits, as cold', async () => {
    const data = make(N)
    const opts = { fuzzyMaxDistance: 0 }
    const t = table(data, opts)
    await t.setSearch('a')
    scored.rows = 0
    for (const q of ['ad', 'ada', 'adam', 'adams']) {
      const before = ids(t).length
      scored.rows = 0
      await t.setSearch(q)
      expect(scored.rows, q).toBe(before)
      expect(ids(t), q).toEqual(await cold(data, q, opts))
      scored.rows = 0
    }
    // A shorter or different query matches every row.
    scored.rows = 0
    await t.setSearch('ad')
    expect(scored.rows).toBe(N)
    expect(ids(t)).toEqual(await cold(data, 'ad', opts))
  })

  it('the check runs on the folded query: case, spaces around it and NFC', async () => {
    const data = make(N)
    const opts = { fuzzyMaxDistance: 0 }
    const t = table(data, opts)
    await t.setSearch('ADA')
    const hits = ids(t).length
    scored.rows = 0
    // Trimmed, folded: 'ada' inside 'adam'.
    await t.setSearch('  AdaM ')
    expect(scored.rows).toBe(hits)
    expect(ids(t)).toEqual(await cold(data, 'adam', opts))
    // Case-sensitive: 'Ada' is not inside 'adam'.
    const cs = table(data, { ...opts, caseSensitive: true })
    await cs.setSearch('Ada')
    scored.rows = 0
    await cs.setSearch('adam')
    expect(scored.rows).toBe(N)
    expect(ids(cs)).toEqual(await cold(data, 'adam', { ...opts, caseSensitive: true }))
  })

  it('raw-prefix traps are not narrowed: Greek final sigma, NFD accents', async () => {
    const data: R[] = [
      { id: 0, name: 'ΟΔΟΣΑ', city: 'x', n: 0 },
      { id: 1, name: 'οδος', city: 'x', n: 0 },
      { id: 2, name: 'café', city: 'x', n: 0 },
      { id: 3, name: 'cafe', city: 'x', n: 0 },
    ]
    const opts = { fuzzyMaxDistance: 0 }
    for (const [a, b] of [
      ['ΟΔΟΣ', 'ΟΔΟΣΑ'],
      ['cafe', 'café'],
    ] as const) {
      const t = table(data, opts)
      await t.setSearch(a)
      scored.rows = 0
      await t.setSearch(b)
      // 'οδος' (final sigma) is not inside 'οδοσα'; 'cafe' is not inside 'café' (NFC).
      expect(scored.rows, b).toBe(data.length)
      expect(ids(t), b).toEqual(await cold(data, b, opts))
      expect(ids(t).length, b).toBeGreaterThan(0)
    }
  })

  it('fuzzy matching on, or a threshold the weights cross: every row is matched', async () => {
    const data = make(N)
    const fuzzy = table(data, {})
    await fuzzy.setSearch('ada')
    scored.rows = 0
    await fuzzy.setSearch('adam')
    expect(scored.rows).toBe(N)
    // City weight 0.5: an exact city (50) passes 0.4, a contains of 'da' in it (32.5) does not.
    const weighted = table(data, { fuzzyMaxDistance: 0, threshold: 0.4 })
    await weighted.setSearch('da')
    scored.rows = 0
    await weighted.setSearch('ada')
    expect(scored.rows).toBe(N)
    expect(ids(weighted)).toEqual(await cold(data, 'ada', { fuzzyMaxDistance: 0, threshold: 0.4 }))
  })

  it('an ex-search without canNarrow (1.2.0) never narrows', async () => {
    const proto = ExSearch.prototype as unknown as { canNarrow?: unknown }
    const own = Object.getOwnPropertyDescriptor(proto, 'canNarrow')
    Object.defineProperty(proto, 'canNarrow', { value: undefined, configurable: true })
    try {
      const data = make(N)
      const t = table(data, { fuzzyMaxDistance: 0 })
      await t.setSearch('ad')
      scored.rows = 0
      await t.setSearch('ada')
      expect(scored.rows).toBe(N)
      expect(ids(t)).toEqual(await cold(data, 'ada', { fuzzyMaxDistance: 0 }))
    } finally {
      if (own) Object.defineProperty(proto, 'canNarrow', own)
    }
  })

  it('rows a filter hid from the previous match are matched when they come back', async () => {
    const data = make(N)
    const opts = { fuzzyMaxDistance: 0 }
    const t = table(data, opts)
    const lt5 = { type: 'range', value: { max: 4 } }
    t.setColumnFilter('n', lt5)
    await t.setSearch('ad')
    t.setColumnFilter('n', undefined)
    await t.setSearch('ada')
    expect(ids(t)).toEqual(await cold(data, 'ada', opts))
    expect(ids(t).some((i) => (data[i] as R).n > 4)).toBe(true)
  })

  it('randomised: edits, filters and query sequences match a cold search', async () => {
    const word = fc.constantFrom(
      'ada',
      'Ada',
      'adam',
      'ΟΔΟΣ',
      'οδοσ',
      'Σ',
      'cafe',
      'café',
      'café',
      'naïve',
      'İz',
      'iz',
      'x',
      'adim',
      'xdam',
    )
    // Queries also start short, inside the cell words: 'da' → 'ada' crosses a weight's threshold.
    const start = fc.oneof(word, fc.constantFrom('a', 'd', 'da', 'ad', 'dam', 'οδ', 'caf', 'i'))
    const sep = fc.constantFrom(' ', '  ', '\t', ' ', '')
    const text = fc
      .array(fc.tuple(word, sep), { maxLength: 3 })
      .map((p) => p.map(([w, s]) => w + s).join(''))
    const row = fc.record({ name: text, city: text, n: fc.nat({ max: 3 }) })
    const tail = fc.constantFrom('a', 'm', 'Σ', 'σ', 'Α', '́', 'é', ' ', 'z', 'Z')
    const step = fc.oneof(
      // Mostly extensions (the narrowable case), some fresh queries.
      { weight: 4, arbitrary: fc.record({ op: fc.constant('extend' as const), add: tail }) },
      { weight: 1, arbitrary: fc.record({ op: fc.constant('prepend' as const), add: tail }) },
      { weight: 1, arbitrary: fc.record({ op: fc.constant('query' as const), q: start }) },
      {
        weight: 1,
        arbitrary: fc.record({ op: fc.constant('mutate' as const), at: fc.nat(), row }),
      },
      {
        weight: 1,
        arbitrary: fc.record({ op: fc.constant('insert' as const), at: fc.nat(), row }),
      },
      { weight: 1, arbitrary: fc.record({ op: fc.constant('delete' as const), at: fc.nat() }) },
      { weight: 1, arbitrary: fc.record({ op: fc.constant('filter' as const), max: fc.nat(4) }) },
    )
    await fc.assert(
      fc.asyncProperty(
        fc.array(row, { maxLength: 30 }),
        start,
        fc.array(step, { minLength: 1, maxLength: 10 }),
        fc.record({
          threshold: fc.constantFrom(0, 0.3, 0.4, 0.6, 0.8),
          fuzzyMaxDistance: fc.constantFrom(0, 0, 1, 2),
          caseSensitive: fc.boolean(),
        }),
        fc.constantFrom<[number, number]>([1, 0.5], [1, 1], [0.8, 0.3], [0.5, 1]),
        async (rows, q0, steps, opts, weights) => {
          let id = 0
          let data: R[] = rows.map((r) => ({ id: id++, ...r }))
          let q = q0
          let filter: unknown
          const t = table(data, opts, weights)
          await t.setSearch(q)
          for (const e of steps) {
            const at = 'at' in e ? e.at % Math.max(1, data.length) : 0
            if (e.op === 'extend') q += e.add
            else if (e.op === 'prepend') q = e.add + q
            else if (e.op === 'query') q = e.q
            else if (e.op === 'filter') {
              filter = e.max === 4 ? undefined : { type: 'range', value: { max: e.max } }
              t.setColumnFilter('n', filter)
            } else {
              if (e.op === 'mutate' && data[at]) Object.assign(data[at] as R, e.row)
              data = data.slice()
              if (e.op === 'insert') data.splice(at, 0, { id: id++, ...e.row })
              if (e.op === 'delete') data.splice(at, 1)
              t.setOptions({ data })
            }
            await t.setSearch(q)
            const c = table(data, opts, weights)
            if (filter) c.setColumnFilter('n', filter)
            await c.setSearch(q)
            expect(ids(t)).toEqual(ids(c))
          }
        },
      ),
      { numRuns: 400 },
    )
  })
})
