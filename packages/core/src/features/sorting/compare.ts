import type { ColumnValues } from '../../pipeline/types'

/**
 * Type ranks of the default comparator (§6.4): mixed-type columns order by rank first. Missing
 * values (`null`, `undefined`, `NaN`, invalid `Date`) rank last and stay last in both directions.
 */
export const RANK = {
  number: 0, // number and bigint (compared with each other by value)
  date: 1,
  string: 2,
  boolean: 3,
  other: 4, // objects, arrays, functions, symbols: equal to each other (stable order)
  missing: 255,
} as const

/** The rank of `v` in {@link RANK}. */
export function typeRank(v: unknown): number {
  switch (typeof v) {
    case 'number':
      return Number.isNaN(v) ? RANK.missing : RANK.number
    case 'bigint':
      return RANK.number
    case 'string':
      return RANK.string
    case 'boolean':
      return RANK.boolean
    case 'undefined':
      return RANK.missing
    default:
      if (v === null) return RANK.missing
      if (v instanceof Date) return Number.isNaN(v.getTime()) ? RANK.missing : RANK.date
      return RANK.other
  }
}

/** Compares two non-missing values of the same rank. */
function sameRank(rank: number, a: unknown, b: unknown, collator: Intl.Collator): number {
  switch (rank) {
    case RANK.number:
      return (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0
    case RANK.date:
      return (a as Date).getTime() - (b as Date).getTime()
    case RANK.string:
      return collator.compare(a as string, b as string)
    case RANK.boolean:
      return a === b ? 0 : a ? 1 : -1
    default:
      return 0
  }
}

/**
 * The default ascending comparator (§6.4): type rank first, missing values last, strings through
 * `collator`. Exported for custom `sortFn`s that want to delegate.
 */
export function compareValues(a: unknown, b: unknown, collator: Intl.Collator): number {
  const ra = typeRank(a)
  const rb = typeRank(b)
  if (ra !== rb) return ra - rb
  return ra === RANK.missing ? 0 : sameRank(ra, a, b, collator)
}

/** A comparator over row indices. */
export type IndexComparator = (a: number, b: number) => number

const ranksCache = new WeakMap<readonly unknown[], Uint8Array>()

/** {@link typeRank} of every value, once per values array (the column cache keeps its identity). */
function ranksOf(values: readonly unknown[]): Uint8Array {
  let r = ranksCache.get(values)
  if (r) return r
  r = new Uint8Array(values.length)
  for (let i = 0; i < values.length; i++) r[i] = typeRank(values[i])
  ranksCache.set(values, r)
  return r
}

/**
 * The default comparator of one sort entry over row indices. Missing values are last whatever
 * `desc` says; everything else is negated for `desc`. A `Float64Array` (all-number column) takes
 * the numeric fast path.
 */
export function defaultIndexComparator(
  values: ColumnValues,
  desc: boolean,
  collator: Intl.Collator,
): IndexComparator {
  const sign = desc ? -1 : 1
  if (values instanceof Float64Array) {
    return (a, b) => {
      const x = values[a] as number
      const y = values[b] as number
      const xm = Number.isNaN(x)
      const ym = Number.isNaN(y)
      if (xm || ym) return xm === ym ? 0 : xm ? 1 : -1
      return x < y ? -sign : x > y ? sign : 0
    }
  }
  const ranks = ranksOf(values)
  return (a, b) => {
    const ra = ranks[a] as number
    const rb = ranks[b] as number
    if (ra === RANK.missing || rb === RANK.missing) {
      return ra === rb ? 0 : ra === RANK.missing ? 1 : -1
    }
    if (ra !== rb) return sign * (ra - rb)
    return sign * sameRank(ra, values[a], values[b], collator)
  }
}

/**
 * A comparator that calls the column's `sortFn` on non-missing values (missing values are still
 * last, in both directions). A throw propagates to the caller (the feature falls back).
 */
export function sortFnIndexComparator(
  values: ColumnValues,
  desc: boolean,
  sortFn: (a: unknown, b: unknown) => number,
): IndexComparator {
  const sign = desc ? -1 : 1
  const ranks = values instanceof Float64Array ? undefined : ranksOf(values)
  const missing = ranks
    ? (i: number) => ranks[i] === RANK.missing
    : (i: number) => Number.isNaN(values[i])
  return (a, b) => {
    const ma = missing(a)
    const mb = missing(b)
    if (ma || mb) return ma === mb ? 0 : ma ? 1 : -1
    return sign * sortFn(values[a], values[b])
  }
}
