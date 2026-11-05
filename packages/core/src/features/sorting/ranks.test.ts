import { describe, expect, it } from 'vitest'
import { runJob } from '../../pipeline/slice'
import { collationRanks, type Ranked } from './ranks'

const real = new Intl.Collator('en', { numeric: true })

/** A collator counting its `compare` calls. */
function counting() {
  const c = {
    calls: 0,
    compare: (a: string, b: string) => {
      c.calls++
      return real.compare(a, b)
    },
  }
  return c
}

const ranks = (values: readonly unknown[], prev?: Ranked, collator = real as Intl.Collator) =>
  runJob(() => collationRanks(values, collator, prev?.state))

/** A seeded PRNG (mulberry32): the property runs are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Collator-equal but distinct strings under { numeric: true } ('a1' = 'a01'), case and accent
// variants, digits, and missing values.
const POOL = [
  'a1',
  'a01',
  'a001',
  'A1',
  'b',
  'B',
  'é',
  'é',
  'e',
  'zebra',
  'Zürich',
  'Ångström',
  'item 2',
  'item 10',
  '',
  ' ',
]

describe('collationRanks (#95, #97)', () => {
  it('ranks are dense, collator-equal strings share one, missing values are NaN', () => {
    const r = ranks(['b', 'a01', null, 'a1', 'c', undefined, Number.NaN, 'b']) as Ranked
    expect(Array.from(r.ranks)).toEqual([1, 0, Number.NaN, 0, 2, Number.NaN, Number.NaN, 1])
  })

  it('a present value that is not a string gives null', () => {
    expect(ranks(['a', 1])).toBeNull()
    expect(ranks(['a', 'b']) && ranks(['a', true], ranks(['a', 'b']) as Ranked)).toBeNull()
  })

  it('incremental ranks equal a cold computation over random edits (property)', () => {
    const next = rng(95)
    const pick = () => {
      const x = next()
      if (x < 0.08) return null
      if (x < 0.1) return undefined
      if (x < 0.55) return POOL[Math.floor(next() * POOL.length)]
      return `s${Math.floor(next() * 400)}`
    }
    for (let run = 0; run < 30; run++) {
      let values: unknown[] = Array.from({ length: Math.floor(next() * 300) }, pick)
      let prev = ranks(values) as Ranked
      for (let step = 0; step < 25; step++) {
        values = values.slice()
        const edits = 1 + Math.floor(next() * 6)
        for (let e = 0; e < edits; e++) {
          const op = next()
          const at = Math.floor(next() * (values.length + 1))
          if (op < 0.4)
            values[at] = pick() // change (or append at the end)
          else if (op < 0.65)
            values.splice(at, 0, pick()) // insert
          else if (op < 0.85)
            values.splice(at, 1) // delete
          else values.reverse() // every row moves
        }
        if (next() < 0.05) values = values.filter((v) => typeof v !== 'string') // all removed
        const warm = ranks(values, prev) as Ranked
        const cold = ranks(values) as Ranked
        expect(Array.from(warm.ranks)).toEqual(Array.from(cold.ranks))
        prev = warm
      }
    }
  })

  it('equals a reference ranking across merge passes, with collator-equal strings (#97)', () => {
    // Over several native runs (2048) and merge passes: 'x7' = 'x07' = 'x007' under numeric.
    const next = rng(97)
    const values = Array.from({ length: 9000 }, () => {
      const k = Math.floor(next() * 3000)
      const zeros = '0'.repeat(Math.floor(next() * 3))
      return next() < 0.02 ? null : `x${zeros}${k}`
    })
    const distinct = [...new Set(values.filter((v): v is string => v !== null))].sort(real.compare)
    const rankOf = new Map<string, number>()
    distinct.forEach((s, k) => {
      const prev = distinct[k - 1]
      const r = prev === undefined ? 0 : (rankOf.get(prev) as number)
      rankOf.set(s, prev !== undefined && real.compare(prev, s) !== 0 ? r + 1 : r)
    })
    const expected = values.map((v) => (v === null ? Number.NaN : rankOf.get(v)))
    const r = ranks(values) as Ranked
    expect(Array.from(r.ranks)).toEqual(expected)
    const edited = values.slice(10)
    edited.push('x5', 'x0005', 'new')
    const warm = ranks(edited, r) as Ranked
    expect(Array.from(warm.ranks)).toEqual(Array.from((ranks(edited) as Ranked).ranks))
  })

  it('never mutates the previous state (a cancelled job leaves it usable)', () => {
    const a = ranks(['b', 'a', 'c']) as Ranked
    const json = (r: Ranked) =>
      JSON.stringify([r.state.values, Array.from(r.state.ranks), r.state.reps])
    const snapshot = json(a)
    const b = ranks(['x', 'a', 'c', 'b0'], a) as Ranked
    expect(json(a)).toBe(snapshot)
    expect(Array.from((ranks(['c', 'b', 'x'], a) as Ranked).ranks)).toEqual([1, 0, 2])
    expect(Array.from((ranks(['b', 'x'], b) as Ranked).ranks)).toEqual([0, 1])
  })

  it('a one-row edit makes O(log d) collator calls, not a cold sort (#95)', () => {
    const d = 20_000
    const values = Array.from({ length: d }, (_, i) => `name ${(i * 2654435761) % 1e9}`)
    const prev = ranks(values) as Ranked
    const edited = values.slice()
    edited[d >> 1] = 'name edited'
    const c = counting()
    const warm = ranks(edited, prev, c as unknown as Intl.Collator) as Ranked
    expect(c.calls).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(d)) + 2)
    expect(Array.from(warm.ranks)).toEqual(Array.from((ranks(edited) as Ranked).ranks))
    // Same strings in a new array (e.g. `data.slice()`): no collator call at all.
    const again = counting()
    ranks(edited.slice(), warm, again as unknown as Intl.Collator)
    expect(again.calls).toBe(0)
    // Rows shifted by an insert at the top: one new string, still O(log d).
    const shifted = counting()
    ranks(['name top', ...edited], warm, shifted as unknown as Intl.Collator)
    expect(shifted.calls).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(d)) + 2)
    // A block of rows removed: one lookup finds the new row offset, the rest reuse their ranks.
    const removed = counting()
    const cut = [...edited.slice(0, 5000), ...edited.slice(5100)]
    const r = ranks(cut, warm, removed as unknown as Intl.Collator) as Ranked
    expect(removed.calls).toBeLessThanOrEqual(Math.ceil(Math.log2(d)) + 1)
    expect(Array.from(r.ranks)).toEqual(Array.from((ranks(cut) as Ranked).ranks))
  })

  it('a cold sort without ties makes no extra equality pass (#97)', () => {
    // One native run (d ≤ the run length): exactly the comparisons of that sort, no second pass
    // over the d - 1 neighbour pairs.
    const d = 1000
    const values = Array.from({ length: d }, (_, i) => `k${(i * 7919) % d}x`)
    const sortOnly = counting()
    Uint32Array.from(values, (_, i) => i).sort((a, b) =>
      sortOnly.compare(values[a] as string, values[b] as string),
    )
    const c = counting()
    const r = ranks(values, undefined, c as unknown as Intl.Collator) as Ranked
    expect(c.calls).toBe(sortOnly.calls)
    expect(r.ranks[0]).toBe(0)
    expect(r.ranks[1]).toBe(7919 % d)
    const two = counting()
    ranks(['b', 'a'], undefined, two as unknown as Intl.Collator)
    expect(two.calls).toBe(1)
  })
})
