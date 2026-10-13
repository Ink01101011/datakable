import { RANK, typeRank } from './compare'

/** Comparisons / rows between two `yield`s of the jobs below (§9.1). */
const CHUNK = 4096
/** Run length sorted natively before the merge passes. */
const RUN = 512

/**
 * Sorts `0..n-1` by `cmp` as a time-sliced job (§9.1): native sorts of short runs, then bottom-up
 * merge passes that `yield` every {@link CHUNK} comparisons. Stable.
 */
function* sortPositions(
  n: number,
  cmp: (a: number, b: number) => number,
): Generator<undefined, Uint32Array, undefined> {
  let a = new Uint32Array(n)
  for (let i = 0; i < n; i++) a[i] = i
  for (let lo = 0; lo < n; lo += RUN) {
    a.subarray(lo, Math.min(lo + RUN, n)).sort(cmp)
    yield
  }
  let b = new Uint32Array(n)
  let ops = 0
  for (let width = RUN; width < n; width *= 2) {
    for (let lo = 0; lo < n; lo += 2 * width) {
      const mid = Math.min(lo + width, n)
      const hi = Math.min(lo + 2 * width, n)
      let i = lo
      let j = mid
      let k = lo
      while (i < mid && j < hi) {
        const x = a[i] as number
        const y = a[j] as number
        if (cmp(y, x) < 0) {
          b[k++] = y
          j++
        } else {
          b[k++] = x
          i++
        }
        if (++ops === CHUNK) {
          ops = 0
          yield
        }
      }
      while (i < mid) b[k++] = a[i++] as number
      while (j < hi) b[k++] = a[j++] as number
    }
    const t = a
    a = b
    b = t
  }
  return a
}

/**
 * Collation ranks of a string column (§6.4, §9.1): per row, the dense rank of its string among
 * the column's distinct strings in `collator` order (strings the collator finds equal share a
 * rank), `NaN` for a missing value. Sorting by these numbers gives exactly the order of
 * `collator.compare`, with integer keys (counting / radix sort) instead of a collator call per
 * comparison. A time-sliced job; `null` when a present value is not a string.
 */
export function* collationRanks(
  values: readonly unknown[],
  collator: Intl.Collator,
): Generator<undefined, Float64Array | null, undefined> {
  const n = values.length
  const ids = new Map<string, number>()
  const distinct: string[] = []
  /** Per row: its string's position in `distinct`, -1 when missing. */
  const slot = new Int32Array(n)
  for (let r = 0; r < n; r++) {
    const v = values[r]
    if (typeof v === 'string') {
      let id = ids.get(v)
      if (id === undefined) {
        id = distinct.length
        ids.set(v, id)
        distinct.push(v)
      }
      slot[r] = id
    } else if (typeRank(v) === RANK.missing) slot[r] = -1
    else return null
    if (r % CHUNK === CHUNK - 1) yield
  }
  const order = yield* sortPositions(distinct.length, (a, b) =>
    collator.compare(distinct[a] as string, distinct[b] as string),
  )
  const rankOf = new Float64Array(distinct.length)
  let rank = 0
  for (let k = 0; k < order.length; k++) {
    const id = order[k] as number
    const s = distinct[id] as string
    if (k > 0 && collator.compare(distinct[order[k - 1] as number] as string, s) !== 0) rank++
    rankOf[id] = rank
    if (k % CHUNK === CHUNK - 1) yield
  }
  const out = new Float64Array(n)
  for (let r = 0; r < n; r++) {
    const id = slot[r] as number
    out[r] = id < 0 ? Number.NaN : (rankOf[id] as number)
  }
  return out
}
