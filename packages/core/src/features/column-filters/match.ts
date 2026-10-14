import type { ColumnValues } from '../../pipeline/types'
import { FILTER_KINDS } from './codes'

/** Result of testing one value: a match, no match, or a value of the wrong type (non-match). */
export const NO = 0
export const MATCH = 1
export const BAD = 2
export type Outcome = typeof NO | typeof MATCH | typeof BAD

/**
 * Tests one non-nullish value. `r` is the row index when the value is the whole cell, `-1` for an
 * element of an array cell (per-row caches apply to whole cells only).
 */
export type Test = (value: unknown, r: number) => Outcome

/** A runtime filter, as read from state (runtime JSON ignores the types). */
export interface RawFilter {
  readonly type?: unknown
  readonly value?: unknown
  readonly fn?: unknown
}

export type Compiled =
  /** Inactive: the step skips it. */
  | { readonly kind: 'off' }
  /** A value test with what it accepts (for `DK_FILTER_TYPE_MISMATCH`). */
  | { readonly kind: 'test'; readonly test: Test; readonly expected: string }
  | {
      readonly kind: 'custom'
      readonly fn: (v: unknown, fv: unknown, row: unknown) => unknown
      readonly value: unknown
    }
  /** Malformed filter value: matches nothing; reported once with `source: 'filter'`. */
  | {
      readonly kind: 'bad'
      readonly filter: string
      readonly expected: string
      readonly received: string
    }

const OFF: Compiled = { kind: 'off' }

/** A short type name for diagnostics: `null`, `array`, `Date`, else `typeof`. Never a value. */
export const typeName = (v: unknown): string =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : v instanceof Date ? 'Date' : typeof v

/** `undefined`, `null` and `''` leave a filter (or a range bound) inactive (§6.1). */
const empty = (v: unknown) => v === undefined || v === null || v === ''

/** Case-insensitive, NFC-normalised form for `contains` (Thai combining marks compare correctly). */
const fold = (s: string) => s.toLowerCase().normalize('NFC')

/**
 * Folded cell strings per column-values array: the column cache returns the same array for the same
 * data and column, so typing into a `contains` filter folds each cell once.
 */
const folded = new WeakMap<ColumnValues, (string | undefined)[]>()

function foldedFor(values: ColumnValues): (string | undefined)[] {
  let f = folded.get(values)
  if (!f) {
    f = new Array<string | undefined>(values.length)
    folded.set(values, f)
  }
  return f
}

const bad = (filter: string, expected: string, received: unknown): Compiled => ({
  kind: 'bad',
  filter,
  expected,
  received: typeName(received),
})

function equals(fv: unknown): Compiled {
  if (empty(fv)) return OFF
  if (fv instanceof Date) {
    const t = fv.getTime()
    return {
      kind: 'test',
      expected: 'Date',
      test: (e) => (e instanceof Date ? (e.getTime() === t ? MATCH : NO) : BAD),
    }
  }
  const type = typeof fv
  if (type === 'object' || type === 'function' || type === 'symbol') {
    return bad('equals', 'prim-or-date', fv)
  }
  return {
    kind: 'test',
    expected: type,
    test: (e) => (typeof e === type ? (e === fv ? MATCH : NO) : BAD),
  }
}

function contains(fv: unknown, values: ColumnValues): Compiled {
  if (empty(fv)) return OFF
  if (typeof fv !== 'string') return bad('contains', 'string', fv)
  const needle = fold(fv)
  const cache = foldedFor(values)
  return {
    kind: 'test',
    expected: 'string',
    test: (e, r) => {
      if (typeof e !== 'string') return BAD
      let s: string | undefined
      if (r < 0) s = fold(e)
      else {
        s = cache[r]
        if (s === undefined) {
          s = fold(e)
          cache[r] = s
        }
      }
      return s.includes(needle) ? MATCH : NO
    },
  }
}

function inList(fv: unknown): Compiled {
  if (fv === undefined || fv === null) return OFF
  if (!Array.isArray(fv)) return bad('in', 'array', fv)
  const prims = new Set<unknown>()
  const times = new Set<number>()
  const types = new Set<string>()
  for (const item of fv as unknown[]) {
    if (item === undefined || item === null) continue
    if (item instanceof Date) times.add(item.getTime())
    else if (typeof item === 'object' || typeof item === 'function') {
      return bad('in', 'prims-or-dates', item)
    } else prims.add(item)
    types.add(typeName(item))
  }
  if (types.size === 0) return OFF
  const hasDate = times.size > 0
  return {
    kind: 'test',
    expected: [...types].join(' | '),
    test: (e) => {
      if (e instanceof Date) return hasDate ? (times.has(e.getTime()) ? MATCH : NO) : BAD
      return types.has(typeof e) ? (prims.has(e) ? MATCH : NO) : BAD
    },
  }
}

type Family = 'number' | 'Date'

/** A range bound: absent, its family + comparable value, or malformed. */
function bound(v: unknown): { family: Family; at: number | bigint } | null | false {
  if (empty(v)) return null
  if (typeof v === 'number' || typeof v === 'bigint') return { family: 'number', at: v }
  if (v instanceof Date && !Number.isNaN(v.getTime())) return { family: 'Date', at: v.getTime() }
  return false
}

const NUMERIC = 'number | bigint'

function range(fv: unknown): Compiled {
  if (fv === undefined || fv === null) return OFF
  if (typeof fv !== 'object' || Array.isArray(fv) || fv instanceof Date) {
    return bad('range', '{ min?, max? }', fv)
  }
  const { min: rawMin, max: rawMax } = fv as { min?: unknown; max?: unknown }
  const min = bound(rawMin)
  const max = bound(rawMax)
  // `expected` prose keys (diagnostics/prose.ts).
  if (min === false) return bad('range', 'range-bound', rawMin)
  if (max === false) return bad('range', 'range-bound', rawMax)
  if (!min && !max) return OFF
  const family = (min || max) as { family: Family }
  if (min && max && min.family !== max.family) {
    return bad('range', `same-type|${min.family}`, rawMax)
  }
  // Mixed number / bigint comparisons are exact in JS (`3n >= 2.5`).
  const lo = min ? (min.at as number) : undefined
  const hi = max ? (max.at as number) : undefined
  const inside = (x: number) => (lo === undefined || x >= lo) && (hi === undefined || x <= hi)
  if (family.family === 'Date') {
    return {
      kind: 'test',
      expected: 'Date',
      test: (e) => (e instanceof Date ? (inside(e.getTime()) ? MATCH : NO) : BAD),
    }
  }
  return {
    kind: 'test',
    expected: NUMERIC,
    test: (e) =>
      typeof e === 'number' || typeof e === 'bigint' ? (inside(e as number) ? MATCH : NO) : BAD,
  }
}

/** Compiles one column's filter for this run (cold: once per active filter per run). */
export function compile(filter: unknown, values: ColumnValues): Compiled {
  if (filter === undefined || filter === null) return OFF
  if (typeof filter !== 'object') return bad('(none)', '{ type, value }', filter)
  const f = filter as RawFilter
  switch (f.type) {
    case 'equals':
      return equals(f.value)
    case 'contains':
      return contains(f.value, values)
    case 'in':
      return inList(f.value)
    case 'range':
      return range(f.value)
    case 'custom':
      return typeof f.fn === 'function'
        ? {
            kind: 'custom',
            fn: f.fn as (v: unknown, fv: unknown, row: unknown) => unknown,
            value: f.value,
          }
        : bad('custom', 'fn: (value, filterValue, row) => boolean', f.fn)
    default:
      return {
        kind: 'bad',
        filter: typeof f.type === 'string' ? f.type : '(none)',
        expected: FILTER_KINDS.join(' | '),
        received: 'unknown filter kind',
      }
  }
}
