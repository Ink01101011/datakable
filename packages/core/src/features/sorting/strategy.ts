import { countingSort } from 'exsorted/counting'
import { mergeSort } from 'exsorted/merge'
import { radixSort } from 'exsorted/radix'
import { timSort } from 'exsorted/tim'
import type { ColumnValues } from '../../pipeline/types'
import type { IndexComparator } from './compare'

/** The built-in algorithms of `sorting({ algorithm })` / a column's `sortAlgorithm` (§6.4). */
export type BuiltinAlgorithm = 'tim' | 'radix' | 'counting' | 'merge' | 'native'

/** Algorithms that need safe-integer keys (they ignore comparators). */
export const needsIntKeys = (a: string) => a === 'radix' || a === 'counting'

/**
 * exsorted's `countingSort` refuses a key range above this (it throws `RangeError`); `auto` never
 * picks it beyond.
 */
const COUNTING_MAX_RANGE = 1_000_000

/**
 * The integer keys of a single-column sort, from one O(n) scan over the input indices (§6.4).
 * Rows with a missing key (`null`, `undefined`, `NaN`, invalid `Date`) are split off: they go last
 * in input order whatever the direction.
 */
export interface IntKeys {
  /** `rows[0..present)`: rows with a key, in input order; `rows[present..)`: missing, reversed. */
  readonly rows: Uint32Array
  readonly present: number
  /** `keys[p]`: the key of `rows[p]`, negated for `desc` (ascending order of keys = output order). */
  readonly keys: Float64Array
  readonly min: number
  readonly max: number
  /** Adjacent pairs out of order (`keys[p] < keys[p - 1]`). */
  readonly descents: number
}

/**
 * Scans `values` at `indices`: every non-missing key must be a safe integer of one kind (numbers,
 * or `Date`s by `getTime()`), else `undefined` (the caller sorts with a comparator). Stops at the
 * first non-integer, so strings and floats cost one read.
 */
export function intKeys(
  values: ColumnValues,
  indices: Uint32Array,
  desc: boolean,
): IntKeys | undefined {
  const n = indices.length
  const numeric = values instanceof Float64Array
  const rows = new Uint32Array(n)
  const keys = new Float64Array(n)
  const sign = desc ? -1 : 1
  let present = 0
  let back = n
  let kind = 0 // 1 = number, 2 = Date
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let descents = 0
  let prev = 0
  for (let i = 0; i < n; i++) {
    const r = indices[i] as number
    let k: number
    if (numeric) {
      k = values[r] as number
    } else {
      const v = (values as readonly unknown[])[r]
      if (typeof v === 'number') {
        if (kind === 2) return undefined
        kind = 1
        k = v
      } else if (v instanceof Date) {
        if (kind === 1) return undefined
        kind = 2
        k = v.getTime()
      } else if (v === null || v === undefined) {
        rows[--back] = r
        continue
      } else return undefined
    }
    if (Number.isNaN(k)) {
      rows[--back] = r
      continue
    }
    if (!Number.isSafeInteger(k)) return undefined
    k *= sign
    if (k < min) min = k
    if (k > max) max = k
    if (present > 0 && k < prev) descents++
    prev = k
    rows[present] = r
    keys[present++] = k
  }
  return { rows, present, keys, min, max, descents }
}

/** `auto`'s choice for integer keys (§6.4 table), with the reason (DK_SORT_STRATEGY). */
export function chooseAuto(k: IntKeys): { algorithm: BuiltinAlgorithm; reason: string } {
  const m = k.present
  const range = m > 0 ? k.max - k.min + 1 : 0
  // Nearly sorted: natural runs average ≥ 64 keys, so tim merges few runs (~O(n)).
  if (k.descents * 64 <= m) {
    return { algorithm: 'tim', reason: `safe integers, nearly sorted (${k.descents} descents)` }
  }
  if (range <= 4 * m && range <= COUNTING_MAX_RANGE) {
    return { algorithm: 'counting', reason: `safe integers, key range ${range} ≤ 4n` }
  }
  if (m >= 10_000) return { algorithm: 'radix', reason: `safe integers, wide range, n ≥ 10k` }
  return { algorithm: 'tim', reason: 'safe integers, wide range, n < 10k' }
}

/**
 * Sorts integer keys with `algorithm` (any built-in but `native`): exsorted works on a plain array
 * of positions (radix / counting require `Array.isArray`), never on the caller's indices. Missing
 * rows are appended in input order. exsorted throws on keys it cannot take (e.g. counting over a
 * range above 1e6): the caller falls back.
 */
export function sortIntKeys(k: IntKeys, algorithm: BuiltinAlgorithm): Uint32Array {
  const { rows, present, keys } = k
  const n = rows.length
  const pos = new Array<number>(present)
  for (let p = 0; p < present; p++) pos[p] = p
  const key = (p: number) => keys[p] as number
  const cmp = (a: number, b: number) => (keys[a] as number) - (keys[b] as number)
  const order =
    algorithm === 'radix'
      ? radixSort(pos, key)
      : algorithm === 'counting'
        ? countingSort(pos, key)
        : algorithm === 'merge'
          ? mergeSort(pos, cmp)
          : algorithm === 'tim'
            ? timSort(pos, cmp)
            : pos.sort(cmp)
  const out = new Uint32Array(n)
  for (let j = 0; j < present; j++) out[j] = rows[order[j] as number] as number
  for (let j = present, b = n - 1; j < n; j++, b--) out[j] = rows[b] as number
  return out
}

/** Sorts a copy of `indices` with a comparator: native, or exsorted tim / merge (stable). */
export function sortWithComparator(
  indices: Uint32Array,
  cmp: IndexComparator,
  algorithm: 'tim' | 'merge' | 'native',
): Uint32Array {
  if (algorithm === 'native') return indices.slice().sort(cmp)
  const a = Array.from(indices)
  return Uint32Array.from(algorithm === 'tim' ? timSort(a, cmp) : mergeSort(a, cmp))
}

/** exsorted's algorithms are usable (§8.5): checked once per feature instance. */
export const hasExsorted = () =>
  typeof timSort === 'function' &&
  typeof mergeSort === 'function' &&
  typeof radixSort === 'function' &&
  typeof countingSort === 'function'
