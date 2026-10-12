import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from '../../diagnostics/types'
import { createTable } from '../../table/create-table'
import { compareValues } from './compare'
import { type SortAlgorithmOption, sorting } from './sorting'

let seen: Diagnostic[]
const onDiagnostic = (d: Diagnostic) => {
  seen.push(d)
}
const of = (code: string) => seen.filter((d) => d.code === code)

beforeEach(() => {
  seen = []
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

type R = { a: unknown; b: unknown }

const collator = new Intl.Collator(undefined, { numeric: true })
const isMissing = (v: unknown) =>
  v === null ||
  v === undefined ||
  (typeof v === 'number' && Number.isNaN(v)) ||
  (v instanceof Date && Number.isNaN(v.getTime()))

/** The reference: an explicit index tie-break (stable by construction), missing last both ways. */
function reference(rows: readonly R[], by: readonly { id: 'a' | 'b'; desc: boolean }[]): number[] {
  const idx = rows.map((_, i) => i)
  return idx.sort((x, y) => {
    for (const e of by) {
      const p = (rows[x] as R)[e.id]
      const q = (rows[y] as R)[e.id]
      const mp = isMissing(p)
      const mq = isMissing(q)
      if (mp || mq) {
        if (mp !== mq) return mp ? 1 : -1
        continue
      }
      const c = compareValues(p, q, collator)
      if (c !== 0) return e.desc ? -c : c
    }
    return x - y
  })
}

const sorted = (
  rows: readonly R[],
  by: readonly { id: 'a' | 'b'; desc: boolean }[],
  algorithm?: SortAlgorithmOption,
) => {
  const t = createTable({
    data: rows,
    columns: [{ key: 'a' }, { key: 'b' }],
    features: [sorting(algorithm === undefined ? {} : { algorithm })],
    onDiagnostic,
  })
  t.setSorting(by as never)
  return t.getRowModel().rows.map((r) => r.index)
}

const ALGORITHMS = ['auto', 'tim', 'radix', 'counting', 'merge', 'native'] as const

const missing = fc.constantFrom(null, undefined, Number.NaN)
const intValue = fc.oneof({ weight: 6, arbitrary: fc.integer({ min: -50, max: 50 }) }, missing)
const wideInt = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: -(2 ** 40), max: 2 ** 40 }) },
  missing,
)
const dateValue = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: 0, max: 40 }).map((d) => new Date(2024, 0, d)) },
  fc.constant(new Date(Number.NaN)),
  missing,
)
const anyValue = fc.oneof(
  fc.integer({ min: -5, max: 5 }),
  fc.double({ noNaN: true, min: -5, max: 5 }),
  fc.constantFrom('a', 'B', 'b', 'file2', 'file10'),
  fc.boolean(),
  missing,
)
const column = fc.oneof(
  fc.array(intValue, { maxLength: 80 }),
  fc.array(wideInt, { maxLength: 80 }),
  fc.array(dateValue, { maxLength: 80 }),
  fc.array(anyValue, { maxLength: 80 }),
)
const rowsArb = column.chain((a) =>
  fc
    .array(fc.integer({ min: 0, max: 3 }), { minLength: a.length, maxLength: a.length })
    .map((b) => a.map((v, i) => ({ a: v, b: b[i] }))),
)

describe('sort strategy — equals the reference stable sort', () => {
  for (const algorithm of ALGORITHMS) {
    it(`${algorithm}: single and multi column, asc and desc`, () => {
      fc.assert(
        fc.property(rowsArb, fc.boolean(), fc.boolean(), fc.boolean(), (rows, desc, multi, d2) => {
          const by = multi
            ? [
                { id: 'b' as const, desc: d2 },
                { id: 'a' as const, desc },
              ]
            : [{ id: 'a' as const, desc }]
          expect(sorted(rows, by, algorithm)).toEqual(reference(rows, by))
        }),
        { numRuns: 150 },
      )
    })
  }

  it('auto on large int columns (radix / counting / tim) equals the reference', () => {
    const n = 12_000
    const make = (f: (i: number) => unknown) =>
      Array.from({ length: n }, (_, i) => ({ a: f(i), b: 0 }))
    const cases = [
      make((i) => (i * 2654435761) % 40_000_000), // wide range, n ≥ 10k → radix
      make((i) => (i * 31) % 997), // narrow range → counting
      make((i) => (i % 500 === 0 ? null : i)), // nearly sorted → tim
      make((i) => ((i * 2654435761) % 40_000_000) - 20_000_000), // negative keys → radix
    ]
    for (const rows of cases) {
      for (const desc of [false, true]) {
        const by = [{ id: 'a' as const, desc }]
        expect(sorted(rows, by)).toEqual(reference(rows, by))
      }
    }
  })
})

/** The algorithm `auto` chose for a single-column sort over `values` (via DK_SORT_STRATEGY). */
function chosen(values: readonly unknown[], desc = false, opts: object = {}) {
  seen = []
  const t = createTable({
    data: values.map((a) => ({ a })),
    columns: [{ key: 'a' }],
    features: [sorting({ debug: true, ...opts })],
    onDiagnostic,
  })
  t.setSorting([{ id: 'a', desc }])
  t.getRowModel()
  const d = of('DK_SORT_STRATEGY')
  expect(d).toHaveLength(1)
  return d[0]?.details as { algorithm: string; reason: string; n: number; ms: number }
}

const range = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i))

describe('sort strategy — auto choice (§6.4 table)', () => {
  it('nearly sorted safe integers → tim', () => {
    expect(chosen(range(1000, (i) => i)).algorithm).toBe('tim')
    expect(
      chosen(
        range(1000, (i) => 1000 - i),
        true,
      ).algorithm,
    ).toBe('tim')
  })

  it('Date keys count as safe integers', () => {
    expect(chosen(range(500, (i) => i).map((d) => new Date(2024, 0, d))).algorithm).toBe('tim')
  })

  it('key range ≤ ~4n → counting', () => {
    expect(chosen(range(1000, (i) => (i * 7919) % 300)).algorithm).toBe('counting')
  })

  it('wide range, n ≥ 10k → radix', () => {
    expect(chosen(range(10_000, (i) => (i * 2654435761) % 10_000_000)).algorithm).toBe('radix')
  })

  it('wide range, n < 10k, not nearly sorted → tim', () => {
    expect(chosen(range(2000, (i) => (i * 2654435761) % 10_000_000)).algorithm).toBe('tim')
  })

  it('strings, floats and bigints → native', () => {
    expect(chosen(['b', 'a', 'c']).algorithm).toBe('native')
    expect(chosen([1.5, 0.5, 2]).algorithm).toBe('native')
    expect(chosen([2n, 1n]).algorithm).toBe('native')
    expect(chosen([1, new Date(0)]).algorithm).toBe('native')
  })

  it('multi-column and custom sortFn → native', () => {
    seen = []
    const t = createTable({
      data: [
        { a: 2, b: 1 },
        { a: 1, b: 2 },
      ],
      columns: [{ key: 'a' }, { key: 'b', sortFn: (x: number, y: number) => x - y }],
      features: [sorting({ debug: true })],
      onDiagnostic,
    })
    t.setSorting([
      { id: 'a', desc: false },
      { id: 'b', desc: false },
    ])
    t.getRowModel()
    expect(of('DK_SORT_STRATEGY')[0]?.details).toMatchObject({ algorithm: 'native' })
    seen = []
    t.setSorting([{ id: 'b', desc: true }])
    t.getRowModel()
    expect(of('DK_SORT_STRATEGY')[0]?.details).toMatchObject({ algorithm: 'native' })
  })

  it('DK_SORT_STRATEGY is info, carries algorithm / reason / n / ms, and only with debug', () => {
    const d = chosen(range(1000, (i) => (i * 7919) % 300))
    expect(d.n).toBe(1000)
    expect(typeof d.ms).toBe('number')
    expect(d.reason).toMatch(/range/)
    const full = of('DK_SORT_STRATEGY')[0] as Diagnostic
    expect(full.level).toBe('info')
    expect(full.where).toEqual({ kind: 'column', index: 0, id: 'a' })
    seen = []
    const t = createTable({
      data: [{ a: 2 }, { a: 1 }],
      columns: [{ key: 'a' }],
      features: [sorting()],
      onDiagnostic,
    })
    t.toggleSort('a')
    t.getRowModel()
    expect(of('DK_SORT_STRATEGY')).toEqual([])
  })
})

describe('sort strategy — overrides', () => {
  it('table-level algorithm is used when eligible', () => {
    expect(
      chosen(
        range(100, (i) => 100 - i),
        false,
        { algorithm: 'radix' },
      ).algorithm,
    ).toBe('radix')
    expect(chosen(['b', 'a'], false, { algorithm: 'merge' }).algorithm).toBe('merge')
    expect(chosen(['b', 'a'], false, { algorithm: 'tim' }).algorithm).toBe('tim')
  })

  it('column-level sortAlgorithm wins over the table-level one', () => {
    seen = []
    const t = createTable({
      data: [{ a: 3 }, { a: 1 }, { a: 2 }],
      columns: [{ key: 'a', sortAlgorithm: 'counting' }],
      features: [sorting({ debug: true, algorithm: 'native' })],
      onDiagnostic,
    })
    t.toggleSort('a')
    expect(t.getRowModel().rows.map((r) => r.original.a)).toEqual([1, 2, 3])
    expect(of('DK_SORT_STRATEGY')[0]?.details).toMatchObject({ algorithm: 'counting' })
  })

  it('radix / counting on non-integer keys: DK_OPTION_NO_EFFECT, sorted by the auto choice', () => {
    seen = []
    const t = createTable({
      data: [{ a: 'b' }, { a: 'a' }],
      columns: [{ key: 'a', sortAlgorithm: 'radix' }],
      features: [sorting({ debug: true })],
      onDiagnostic,
    })
    t.toggleSort('a')
    expect(t.getRowModel().rows.map((r) => r.original.a)).toEqual(['a', 'b'])
    const d = of('DK_OPTION_NO_EFFECT')[0] as Diagnostic
    expect(d.where).toEqual({ kind: 'option', path: 'columns[0].sortAlgorithm' })
    expect(d.details.reason).toMatch(/safe integer/)
    expect(of('DK_SORT_STRATEGY')[0]?.details).toMatchObject({ algorithm: 'native' })
  })

  it('counting over a key range exsorted refuses falls back with DK_OPTION_NO_EFFECT', () => {
    seen = []
    const t = createTable({
      data: [{ a: 0 }, { a: 2 ** 40 }, { a: 5 }],
      columns: [{ key: 'a' }],
      features: [sorting({ algorithm: 'counting' })],
      onDiagnostic,
    })
    t.toggleSort('a')
    expect(t.getRowModel().rows.map((r) => r.original.a)).toEqual([0, 5, 2 ** 40])
    const d = of('DK_OPTION_NO_EFFECT')[0] as Diagnostic
    expect(d.where).toEqual({ kind: 'feature', name: 'sorting' })
  })

  it('an unknown column sortAlgorithm: DK_OPTION_NO_EFFECT, auto is used', () => {
    seen = []
    const t = createTable({
      data: [{ a: 2 }, { a: 1 }],
      columns: [{ key: 'a', sortAlgorithm: 'quick' as never }],
      features: [sorting()],
      onDiagnostic,
    })
    t.toggleSort('a')
    expect(t.getRowModel().rows.map((r) => r.original.a)).toEqual([1, 2])
    expect(of('DK_OPTION_NO_EFFECT')[0]?.details.reason).toMatch(/quick/)
  })

  it('an invalid table-level algorithm is a config error', () => {
    expect(() =>
      createTable({ data: [], features: [sorting({ algorithm: 'quick' as never })] }),
    ).toThrow(/DK_INVALID_OPTION/)
  })

  it('a custom algorithm gets a copy of the indices and the comparator', () => {
    const data = [{ a: 3 }, { a: 1 }, { a: 2 }]
    const custom = vi.fn((indices: Uint32Array, cmp: (a: number, b: number) => number) =>
      Uint32Array.from(Array.from(indices).sort(cmp)),
    )
    const t = createTable({
      data,
      columns: [{ key: 'a' }],
      features: [sorting({ algorithm: custom })],
      onDiagnostic,
    })
    t.setSorting([{ id: 'a', desc: true }])
    expect(t.getRowModel().rows.map((r) => r.original.a)).toEqual([3, 2, 1])
    expect(custom).toHaveBeenCalledTimes(1)
  })

  it('a throwing custom algorithm: DK_CALLBACK_FAILED, native fallback', () => {
    const t = createTable({
      data: [{ a: 3 }, { a: 1 }],
      columns: [{ key: 'a' }],
      features: [
        sorting({
          algorithm: () => {
            throw new Error('nope')
          },
        }),
      ],
      onDiagnostic,
    })
    t.toggleSort('a')
    expect(t.getRowModel().rows.map((r) => r.original.a)).toEqual([1, 3])
    const d = of('DK_CALLBACK_FAILED')[0] as Diagnostic
    expect(d.details.slot).toBe('sorting.algorithm')
  })

  it('a custom algorithm with a bad return: DK_CALLBACK_BAD_RETURN, native fallback', () => {
    const t = createTable({
      data: [{ a: 3 }, { a: 1 }],
      columns: [{ key: 'a', sortAlgorithm: () => [1, 0] as never }],
      features: [sorting()],
      onDiagnostic,
    })
    t.toggleSort('a')
    expect(t.getRowModel().rows.map((r) => r.original.a)).toEqual([1, 3])
    const d = of('DK_CALLBACK_BAD_RETURN')[0] as Diagnostic
    expect(d.details.slot).toBe('columns[0].sortAlgorithm')
  })

  it('a throwing sortFn under tim / merge still falls back to the default comparator', () => {
    for (const algorithm of ['tim', 'merge'] as const) {
      seen = []
      const t = createTable({
        data: [{ a: 3 }, { a: 1 }, { a: 2 }],
        columns: [
          {
            key: 'a',
            sortFn: () => {
              throw new Error('x')
            },
          },
        ],
        features: [sorting({ algorithm })],
        onDiagnostic,
      })
      t.toggleSort('a')
      expect(t.getRowModel().rows.map((r) => r.original.a)).toEqual([1, 2, 3])
      expect(of('DK_CALLBACK_FAILED')[0]?.details.slot).toBe('columns[0].sortFn')
    }
  })
})

describe('DK_SORT_COMPARATOR_INVALID (dev, sampled)', () => {
  const run = (sortFn: (a: number, b: number) => number) => {
    seen = []
    const data = [5, 3, null, 9, 1, 7].map((a) => ({ a }))
    const t = createTable({
      data,
      columns: [{ key: 'a', sortFn: sortFn as never }],
      features: [sorting()],
      onDiagnostic,
    })
    t.toggleSort('a')
    return t.getRowModel().rows.map((r) => r.original.a)
  }

  it('NaN returns → warn, default comparator', () => {
    expect(run(() => Number.NaN)).toEqual([1, 3, 5, 7, 9, null])
    const d = of('DK_SORT_COMPARATOR_INVALID')[0] as Diagnostic
    expect(d.level).toBe('warn')
    expect(d.where).toEqual({ kind: 'option', path: 'columns[0].sortFn' })
    expect(d.details.reason).toBe('nan')
  })

  it('non-number returns → warn', () => {
    expect(run((() => 'x') as never)).toEqual([1, 3, 5, 7, 9, null])
    expect(of('DK_SORT_COMPARATOR_INVALID')[0]?.details.reason).toBe('not-number')
  })

  it('inconsistent (asymmetric) → warn', () => {
    expect(run(() => 1)).toEqual([1, 3, 5, 7, 9, null])
    expect(of('DK_SORT_COMPARATOR_INVALID')[0]?.details.reason).toBe('inconsistent')
  })

  it('a consistent sortFn is not reported', () => {
    expect(run((a, b) => b - a)).toEqual([9, 7, 5, 3, 1, null])
    expect(of('DK_SORT_COMPARATOR_INVALID')).toEqual([])
  })
})
