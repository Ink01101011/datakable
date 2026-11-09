import { ExSearch } from 'ex-search'
import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTable } from '../../table/create-table'
import { search } from './search'

// #95 (search half): a new data array re-scores only the rows whose searched text changed. The
// scores of the previous version are reused by a per-row hash of the searched texts, compared at
// the same position (or shifted by the length change), never by row identity: a row changed in
// place and passed in a new array is scored again.

type R = { id: number; name: string; city: string; n: number | null }

const columns = [
  { key: 'name' as const, search: 1 },
  { key: 'city' as const, search: 0.5 },
  { key: 'n' as const, search: 0.8 },
]

const ids = (t: { getRowModel(): { rows: readonly { index: number }[] } }) =>
  t.getRowModel().rows.map((r) => r.index)

const table = (data: readonly R[], _q?: string) => {
  const t = createTable({ data, columns, features: [search()] }) as never as {
    setSearch(q: string): Promise<unknown>
    setOptions(o: { data: readonly R[] }): void
    getRowModel(): { rows: readonly { index: number }[] }
  }
  return t
}

/** Rows handed to ex-search for scoring (each `search` call scores the view's current chunk). */
function countScored() {
  const views = new WeakMap<object, { length: number }>()
  const scored = { rows: 0 }
  const setData = ExSearch.prototype.setData
  vi.spyOn(ExSearch.prototype, 'setData').mockImplementation(function (this: object, items) {
    views.set(this, items as unknown as { length: number })
    return setData.call(this as never, items)
  })
  const run = ExSearch.prototype.search
  vi.spyOn(ExSearch.prototype, 'search').mockImplementation(function (this: object, q) {
    scored.rows += views.get(this)?.length ?? 0
    return run.call(this as never, q)
  })
  return scored
}

beforeEach(() => {
  vi.restoreAllMocks()
})
afterEach(() => {
  vi.restoreAllMocks()
})

const N = 1000
const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'Zürich', 'naïve', 'ada', 'adam']
const make = (n: number): R[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i,
    name: `${words[i % 9]} ${words[(i * 7) % 9]} ${i}`,
    city: words[(i * 5) % 9] as string,
    n: i % 11 === 0 ? null : i,
  }))

describe('search: a new data array re-scores only what changed (#95)', () => {
  it('one row replaced in a new array: one row scored, results as cold', async () => {
    const data = make(N)
    const t = table(data, 'ada')
    await t.setSearch('ada')
    const scored = countScored()
    const next = data.slice()
    next[500] = { id: 500, name: 'ada lovelace', city: 'x', n: 1 }
    t.setOptions({ data: next })
    const got = ids(t)
    expect(scored.rows).toBe(1)
    const cold = table(next, 'ada')
    await cold.setSearch('ada')
    expect(got).toEqual(ids(cold))
    expect(got).toContain(500)
  })

  it('a row changed in place and passed in a new array is scored again (not by identity)', async () => {
    const data = make(N)
    const t = table(data, 'ada')
    await t.setSearch('ada')
    expect(ids(t)).not.toContain(4)
    const scored = countScored()
    const row = data[4] as R
    row.name = 'ada'
    const next = data.slice()
    t.setOptions({ data: next })
    expect(scored.rows).toBe(1)
    expect(ids(t)[0]).toBe(4)
  })

  it('text moved between columns is a change (each text is closed in the hash)', async () => {
    const data: R[] = [
      { id: 0, name: 'ab', city: 'c', n: null },
      { id: 1, name: 'a\0', city: 'b', n: null },
    ]
    const t = table(data, 'ab')
    await t.setSearch('ab')
    const scored = countScored()
    Object.assign(data[0] as R, { name: 'a', city: 'bc' })
    Object.assign(data[1] as R, { name: 'a', city: '\0b' })
    t.setOptions({ data: data.slice() })
    expect(scored.rows).toBe(2)
  })

  it('the same rows in a new array score nothing; a prepended row scores one', async () => {
    const data = make(N)
    const t = table(data, 'echo')
    await t.setSearch('echo')
    const before = ids(t)
    const scored = countScored()
    t.setOptions({ data: data.slice() })
    expect(ids(t)).toEqual(before)
    expect(scored.rows).toBe(0)
    const next = [{ id: -1, name: 'zzz', city: 'zzz', n: 0 }, ...data]
    t.setOptions({ data: next })
    expect(scored.rows).toBe(1)
    expect(ids(t)).toEqual(before.map((i) => i + 1))
    const shorter = next.filter((_, i) => i !== 300)
    t.setOptions({ data: shorter })
    expect(scored.rows).toBe(1)
  })

  it('a new query on the same data hashes no row: only the scoring reads the rows', async () => {
    let reads = 0
    const data = make(N).map((r) => {
      const { name, ...rest } = r
      return Object.defineProperty(rest, 'name', {
        enumerable: true,
        get: () => {
          reads++
          return name
        },
      }) as R
    })
    const scored = countScored()
    const t = table(data, 'ada')
    await t.setSearch('ada')
    expect(scored.rows).toBe(N)
    // First query: the index scan, the hash pass and the scoring each read every row once.
    expect(reads).toBe(3 * N)
    for (const q of ['bravo', 'alpha', 'ada lovelace']) {
      reads = 0
      scored.rows = 0
      await t.setSearch(q)
      expect(scored.rows).toBe(N)
      expect(reads).toBe(N)
    }
  })

  it('a new query scores every row again', async () => {
    const data = make(N)
    const scored = countScored()
    const t = table(data, 'ada')
    await t.setSearch('ada')
    expect(scored.rows).toBe(N)
    scored.rows = 0
    await t.setSearch('bravo')
    expect(scored.rows).toBe(N)
  })

  it('randomised: incremental results equal a cold search after any edit sequence', async () => {
    const text = fc.constantFrom('ada', 'adam', 'bob', 'Zürich', 'naïve', 'zu', 'a', '', 'ADA x')
    const row = fc.record({ name: text, city: text, n: fc.option(fc.integer({ max: 20 })) })
    const edit = fc.oneof(
      fc.record({ op: fc.constant('mutate' as const), at: fc.nat(), row }),
      fc.record({ op: fc.constant('replace' as const), at: fc.nat(), row }),
      fc.record({ op: fc.constant('insert' as const), at: fc.nat(), row }),
      fc.record({ op: fc.constant('delete' as const), at: fc.nat() }),
      fc.record({ op: fc.constant('reverse' as const) }),
      fc.record({ op: fc.constant('rotate' as const), at: fc.nat() }),
      fc.record({ op: fc.constant('copy' as const) }),
      fc.record({ op: fc.constant('query' as const), q: text }),
    )
    await fc.assert(
      fc.asyncProperty(
        fc.array(row, { maxLength: 40 }),
        text,
        fc.array(edit, { maxLength: 12 }),
        async (rows, q0, edits) => {
          let id = 0
          let data: R[] = rows.map((r) => ({ id: id++, ...r }))
          let q = q0 === '' ? 'ada' : q0
          const t = table(data, q)
          await t.setSearch(q)
          for (const e of edits) {
            const at = 'at' in e ? e.at % Math.max(1, data.length) : 0
            if (e.op === 'query') {
              q = e.q === '' ? q : e.q
              await t.setSearch(q)
              continue
            }
            if (e.op === 'mutate' && data[at]) Object.assign(data[at] as R, e.row)
            data = data.slice()
            if (e.op === 'replace' && data[at]) data[at] = { id: id++, ...e.row }
            if (e.op === 'insert') data.splice(at, 0, { id: id++, ...e.row })
            if (e.op === 'delete') data.splice(at, 1)
            if (e.op === 'reverse') data.reverse()
            if (e.op === 'rotate') data = [...data.slice(at), ...data.slice(0, at)]
            t.setOptions({ data })
            const cold = table(data, q)
            await cold.setSearch(q)
            expect(ids(t)).toEqual(ids(cold))
          }
        },
      ),
      { numRuns: 300 },
    )
  })
})
