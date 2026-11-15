import { describe, expect, it, vi } from 'vitest'
import { createTable } from '../../table/create-table'
import reference from './datakable-2.1.1-nonfinite.ref.json'
import { type SearchOptions, search } from './search'

// R F2 (#123): ex-search 2.x throws on a non-finite weight or threshold; 1.2.1 scored with them. A
// minor release keeps what datakable 2.1.1 returned for these configurations in production: the
// rows, their order and the status recorded with the published `datakable@2.1.1` from npm
// (`datakable-2.1.1-nonfinite.ref.json`, `production`: the same data, cases and keystrokes, typed
// one after another on one table). Development builds report a non-finite column weight
// (DK_INVALID_OPTION, search.test.ts) and rejected a non-finite threshold in 2.1.1 already.

vi.mock('../../diagnostics/env', () => ({ DEV: false }))

type R = {
  id: number
  name: string | null | undefined
  city: string
  n: number | null | undefined
  tags: string[]
  address: { street: string; zip: string } | null
}

/** mulberry32: the same rows on every run (ex-search-2.test.ts). */
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
  'naïve',
  'café',
  'café',
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

/** One-word, narrowing (`lop` → `lopez`), multi-word, blank, and a query typed again. */
const QUERIES = [
  'ada',
  'lop',
  'lope',
  'lopez',
  'lopex',
  'ada lovelace',
  'bangkok',
  'kok',
  '12',
  'zurich',
  'x',
  '  ',
  'ada',
]

type Case = [columns: readonly object[], options: SearchOptions]
const X: Record<string, number> = {
  Infinity: Number.POSITIVE_INFINITY,
  '-Infinity': Number.NEGATIVE_INFINITY,
  NaN: Number.NaN,
}
const CASES: Record<string, Case> = {}
for (const [n, x] of Object.entries(X)) {
  CASES[`name ${n}`] = [[{ key: 'name', search: x }, { key: 'city' }], {}]
  CASES[`name ${n}, city 1`] = [
    [
      { key: 'name', search: x },
      { key: 'city', search: 1 },
    ],
    {},
  ]
  CASES[`name 1, city ${n}, n 0.8`] = [
    [
      { key: 'name', search: 1 },
      { key: 'city', search: x },
      { key: 'n', search: 0.8 },
    ],
    {},
  ]
  CASES[`name ${n}, city 0.5, fuzzyMaxDistance 0`] = [
    [
      { key: 'name', search: x },
      { key: 'city', search: 0.5 },
    ],
    { fuzzyMaxDistance: 0 },
  ]
}
for (const [n, x] of Object.entries(X)) {
  CASES[`threshold ${n}, name 1`] = [
    [{ key: 'name', search: 1 }, { key: 'city' }],
    { threshold: x },
  ]
  CASES[`threshold ${n}, name 1, city 0.5`] = [
    [
      { key: 'name', search: 1 },
      { key: 'city', search: 0.5 },
    ],
    { threshold: x },
  ]
  CASES[`threshold ${n}, zero-config`] = [
    [{ key: 'name' }, { key: 'city' }, { key: 'n' }],
    { threshold: x },
  ]
  CASES[`threshold ${n}, name Infinity`] = [
    [{ key: 'name', search: Number.POSITIVE_INFINITY }, { key: 'city' }],
    { threshold: x },
  ]
  CASES[`threshold ${n}, name Infinity, city 1`] = [
    [
      { key: 'name', search: Number.POSITIVE_INFINITY },
      { key: 'city', search: 1 },
    ],
    { threshold: x },
  ]
}

type T = {
  setSearch(q: string): Promise<unknown>
  getRowModel(): { status: string; rows: readonly { index: number }[] }
}

async function typed([columns, options]: Case): Promise<string[]> {
  const t = createTable({
    data: DATA,
    columns: columns as never,
    features: [search(options)],
    onDiagnostic() {},
  }) as never as T
  const out: string[] = []
  for (const q of QUERIES) {
    await t.setSearch(q)
    const m = t.getRowModel()
    out.push(`${m.status}: ${m.rows.map((r) => r.index).join()}`)
  }
  return out
}

describe('production: a non-finite weight or threshold searches as in datakable 2.1.1 (R F2)', () => {
  it('every case: the rows, order and status of the 2.1.1 reference', async () => {
    expect(reference.queries).toEqual(QUERIES)
    const expected = reference.production as Record<string, string[]>
    expect(Object.keys(CASES)).toEqual(Object.keys(expected))
    for (const [name, c] of Object.entries(CASES)) {
      const got = await typed(c)
      const ref = expected[name] as string[]
      for (let j = 0; j < QUERIES.length; j++) {
        expect(got[j], `${name} "${QUERIES[j]}"`).toBe(ref[j])
      }
    }
  })

  it('the reference is not vacuous: an infinite weight ranks rows, a NaN threshold keeps all', () => {
    const p = reference.production as Record<string, string[]>
    expect(p['name Infinity']?.[0]).toMatch(/^idle: \d+(,\d+){5,}$/)
    expect(p['threshold NaN, name 1']?.[0]?.split(',')).toHaveLength(DATA.length)
    expect(p['threshold Infinity, name 1']?.[0]).toBe('idle: ')
  })
})
