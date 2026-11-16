import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from '../../diagnostics/types'
import { createTable } from '../../table/create-table'
import { columnFilters } from '../column-filters'
import { search } from './search'
import { withSearchFn } from './with-search-fn'

// #123: `fuzzyMaxRows` is an explicit opt-in for large data. When the data array has more rows
// than it (all rows, before filters), matching runs as with `fuzzyMaxDistance: 0`: exact, prefix
// and substring matches only, no word index kept. At or below it the configured distance applies.
// Omitted: never (the behaviour before the option).

type R = { id: number; name: string; city: string; n: number }

const columns = [
  { key: 'name' as const, search: 1 },
  { key: 'city' as const, search: 0.5 },
]

type T = {
  setSearch(q: string): Promise<unknown>
  setOptions(o: { data: readonly R[] }): void
  setColumnFilter(id: string, filter: unknown): void
  getRowModel(): { rows: readonly { index: number }[] }
}

let seen: Diagnostic[]
const onDiagnostic = (d: Diagnostic) => {
  seen.push(d)
}
const fuzzyOff = () => seen.filter((d) => d.code === 'DK_SEARCH_FUZZY_OFF')

beforeEach(() => {
  seen = []
  vi.restoreAllMocks()
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

const table = (data: readonly R[], opts: Parameters<typeof search>[0] = {}) =>
  createTable({
    data,
    columns: [...columns, { key: 'n' as const }],
    onDiagnostic,
    features: [columnFilters(), search(opts)],
  }) as never as T

const ids = (t: T) => t.getRowModel().rows.map((r) => r.index)

const names = ['Cara Lopez', 'Ada', 'Bob', 'Adams', 'Carla', 'Mali', 'Somchai']
const make = (count: number): R[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i,
    name: names[i % names.length] as string,
    city: i % 2 ? 'Bangkok' : 'Chiang Mai',
    n: i,
  }))

/** Queries: a typo of one word (`carx` → Cara), a typo of a city, exact, prefix and substring. */
const QUERIES = ['carx', 'lopes', 'bangkck', 'ada', 'car', 'ang', 'cara lopez', 'mali']

async function results(t: T) {
  const out: Record<string, number[]> = {}
  for (const q of QUERIES) {
    await t.setSearch(q)
    out[q] = ids(t)
  }
  return out
}

describe('search({ fuzzyMaxRows }) (#123)', () => {
  it('omitted: nothing changes (the results of search() without it, at any size)', async () => {
    for (const count of [5, 50]) {
      const data = make(count)
      const plain = await results(table(data))
      // `undefined` (from plain JS) is "not set", like omitting it.
      expect(await results(table(data, { fuzzyMaxRows: undefined } as never))).toEqual(plain)
      // Typos still match: fuzzy matching stays on.
      expect(plain.carx?.length).toBeGreaterThan(0)
    }
    expect(fuzzyOff()).toEqual([])
  })

  it('Infinity: never, the same as omitting it (R F5)', async () => {
    const data = make(50)
    const plain = await results(table(data))
    expect(await results(table(data, { fuzzyMaxRows: Number.POSITIVE_INFINITY }))).toEqual(plain)
    expect(fuzzyOff()).toEqual([])
  })

  it('n == limit: fuzzy matching on; n == limit + 1: off', async () => {
    const at = table(make(7), { fuzzyMaxRows: 7 })
    await at.setSearch('carx')
    expect(ids(at)).toEqual([0, 4])
    const over = table(make(8), { fuzzyMaxRows: 7 })
    await over.setSearch('carx')
    expect(ids(over)).toEqual([])
    // A typo of one word of a multi-word cell (word matching) too.
    await at.setSearch('lopes')
    expect(ids(at)).toEqual([0])
    await over.setSearch('lopes')
    expect(ids(over)).toEqual([])
  })

  it('above the limit: the results of a fuzzyMaxDistance: 0 table, exact / prefix / substring hits kept', async () => {
    const data = make(30)
    const limited = await results(table(data, { fuzzyMaxRows: 10 }))
    expect(limited).toEqual(await results(table(data, { fuzzyMaxDistance: 0 })))
    expect(limited.car).toEqual(await results(table(data)).then((r) => r.car))
    expect(limited.ada?.length).toBeGreaterThan(0)
    expect(limited.ang?.length).toBeGreaterThan(0)
    expect(limited.carx).toEqual([])
    // At or below the limit: the configured distance applies.
    expect(await results(table(data, { fuzzyMaxRows: 30, fuzzyMaxDistance: 2 }))).toEqual(
      await results(table(data, { fuzzyMaxDistance: 2 })),
    )
  })

  it('counts every row of the data array, before filters: filtering does not flip the mode', async () => {
    const t = table(make(8), { fuzzyMaxRows: 7 })
    t.setColumnFilter('n', { type: 'range', value: { max: 3 } })
    await t.setSearch('carx')
    expect(ids(t)).toEqual([])
    const below = table(make(7), { fuzzyMaxRows: 7 })
    below.setColumnFilter('n', { type: 'range', value: { max: 3 } })
    await below.setSearch('carx')
    expect(ids(below)).toEqual([0])
  })

  it('crossing the limit with new data, up and down: the new mode at once, no score of the other kept', async () => {
    const small = make(7)
    const t = table(small, { fuzzyMaxRows: 7 })
    await t.setSearch('carx')
    expect(ids(t)).toEqual([0, 4])
    // Up: the same rows plus one. Rows 0..6 hash the same, but their fuzzy scores are not reused.
    const big = [...small, { id: 7, name: 'Ada', city: 'Bangkok', n: 7 }]
    t.setOptions({ data: big })
    expect(ids(t)).toEqual([])
    // Down again: fuzzy matching is back, its scores not taken from the exact-only match.
    t.setOptions({ data: big.slice(0, 7) })
    expect(ids(t)).toEqual([0, 4])
    // The same check, a narrowing keystroke on each side.
    t.setOptions({ data: big })
    await t.setSearch('carxa')
    expect(ids(t)).toEqual([])
    t.setOptions({ data: big.slice(1) })
    const cold = table(big.slice(1))
    await cold.setSearch('carxa')
    expect(ids(t)).toEqual(ids(cold))
    expect(ids(t).length).toBeGreaterThan(0)
  })

  it('randomised: results equal a cold table built with the effective fuzzyMaxDistance', async () => {
    const LIMIT = 6
    const text = fc.constantFrom('Cara', 'cara lopez', 'Ada', 'adam', 'Zürich', 'bob', 'lopes', 'x')
    const row = fc.record({ name: text, city: text })
    const edit = fc.oneof(
      fc.record({ op: fc.constant('insert' as const), at: fc.nat(), row }),
      fc.record({ op: fc.constant('delete' as const), at: fc.nat() }),
      fc.record({ op: fc.constant('replace' as const), at: fc.nat(), row }),
      fc.record({ op: fc.constant('mutate' as const), at: fc.nat(), row }),
      fc.record({ op: fc.constant('copy' as const) }),
      fc.record({ op: fc.constant('query' as const), q: fc.constantFrom(...QUERIES, 'ad', 'adx') }),
    )
    await fc.assert(
      fc.asyncProperty(
        fc.array(row, { minLength: 3, maxLength: 10 }),
        fc.constantFrom(...QUERIES),
        fc.array(edit, { maxLength: 12 }),
        fc.constantFrom(0, 1, 3),
        async (rows, q0, edits, distance) => {
          let id = 0
          let data: R[] = rows.map((r) => ({ id: id, n: id++, ...r }))
          let q = q0
          const t = table(data, { fuzzyMaxRows: LIMIT, fuzzyMaxDistance: distance })
          await t.setSearch(q)
          const check = async () => {
            const cold = table(data, {
              fuzzyMaxDistance: data.length > LIMIT ? 0 : distance,
            })
            await cold.setSearch(q)
            expect(ids(t)).toEqual(ids(cold))
          }
          await check()
          for (const e of edits) {
            const at = 'at' in e ? e.at % Math.max(1, data.length) : 0
            if (e.op === 'query') {
              q = e.q
              await t.setSearch(q)
              await check()
              continue
            }
            if (e.op === 'mutate' && data[at]) Object.assign(data[at] as R, e.row)
            data = data.slice()
            if (e.op === 'replace' && data[at]) data[at] = { id, n: id++, ...e.row }
            if (e.op === 'insert') data.splice(at, 0, { id, n: id++, ...e.row })
            if (e.op === 'delete') data.splice(at, 1)
            t.setOptions({ data })
            await check()
          }
        },
      ),
      { numRuns: 300 },
    )
  })

  it('above the limit no word is split (no word index): like fuzzyMaxDistance 0', async () => {
    const data = make(8)
    const cells = new Set(data.flatMap((r) => [r.name, r.city].map((v) => v.toLowerCase())))
    const count = async (opts: Parameters<typeof search>[0]) => {
      const t = table(data, opts)
      const counted = { calls: 0 }
      const charCodeAt = String.prototype.charCodeAt
      const spy = vi.spyOn(String.prototype, 'charCodeAt').mockImplementation(function (
        this: string,
        i,
      ) {
        if (cells.has(String(this))) counted.calls++
        return charCodeAt.call(this, i)
      })
      await t.setSearch('carx')
      await t.setSearch('lopes')
      spy.mockRestore()
      return counted.calls
    }
    const exact = await count({ fuzzyMaxDistance: 0 })
    expect(await count({ fuzzyMaxRows: 7 })).toBe(exact)
    // At the limit the words of each cell are split (the word index is built).
    expect(await count({ fuzzyMaxRows: 8 })).toBeGreaterThan(exact)
  })

  it('DK_SEARCH_FUZZY_OFF (development, info): once per data array, only when it switches fuzzy off', async () => {
    const data = make(8)
    const t = table(data, { fuzzyMaxRows: 7 })
    expect(fuzzyOff()).toEqual([])
    for (const q of ['carx', 'carxa', 'ada']) await t.setSearch(q)
    expect(fuzzyOff()).toHaveLength(1)
    const d = fuzzyOff()[0] as Diagnostic
    expect(d.level).toBe('info')
    expect(d.where).toEqual({ kind: 'option', path: 'fuzzyMaxRows' })
    expect(d.details).toMatchObject({ rows: 8, limit: 7 })
    expect(d.fix.join(' ')).toContain('fuzzyMaxRows')
    // A new data array above the limit: once more. Below it: none.
    t.setOptions({ data: data.slice() })
    expect(fuzzyOff()).toHaveLength(2)
    t.setOptions({ data: data.slice(1) })
    await t.setSearch('carx')
    expect(fuzzyOff()).toHaveLength(2)
    // Nothing to switch off: fuzzy matching is off already.
    await table(data, { fuzzyMaxRows: 7, fuzzyMaxDistance: 0 }).setSearch('carx')
    expect(fuzzyOff()).toHaveLength(2)
  })
})

describe('search({ fuzzyMaxRows }): options (#123)', () => {
  it('a non-negative integer or Infinity, else DK_INVALID_OPTION', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.NEGATIVE_INFINITY, '10', null]) {
      expect(() => table(make(3), { fuzzyMaxRows: bad as never }), String(bad)).toThrow(
        /DK_INVALID_OPTION|fuzzyMaxRows/,
      )
    }
    for (const ok of [0, 1, 50_000, Number.POSITIVE_INFINITY]) {
      seen = []
      table(make(3), { fuzzyMaxRows: ok })
      expect(seen.map((d) => d.code)).toEqual([])
    }
  })

  it('no effect with a searchFn (DK_OPTION_NO_EFFECT), like threshold and fuzzyMaxDistance', () => {
    table(make(3), { fuzzyMaxRows: 10, searchFn: withSearchFn(() => []) as never })
    const noEffect = seen.filter((d) => d.code === 'DK_OPTION_NO_EFFECT')
    expect(noEffect.map((d) => (d.details as { path?: string }).path)).toContain('fuzzyMaxRows')
  })
})
