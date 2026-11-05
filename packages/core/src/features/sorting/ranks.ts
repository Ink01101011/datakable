import { RANK, typeRank } from './compare'

/** Comparisons / rows between two `yield`s of the jobs below (§9.1). */
const CHUNK = 4096
/**
 * Run length sorted natively before the merge passes (#97, was 512): each doubling saves a merge
 * pass, and one native run of collator calls stays within a slice even under a 4x CPU throttle.
 */
const RUN = 1024

/**
 * Sorts `0..n-1` by `cmp` as a time-sliced job (§9.1): native sorts of `run`s, then bottom-up
 * merge passes that `yield` every {@link CHUNK} comparisons. Stable. Also returns `eq`:
 * `eq[k] = 1` when `order[k]` compares equal to `order[k - 1]`, from the comparisons the merges
 * make anyway (#97). Inside a native run it costs a second pass only when that sort saw a 0.
 */
function* sortPositions(
  n: number,
  cmp: (a: number, b: number) => number,
  run: number,
): Generator<undefined, { order: Uint32Array; eq: Uint8Array }, undefined> {
  let a = new Uint32Array(n)
  let ea = new Uint8Array(n)
  for (let i = 0; i < n; i++) a[i] = i
  for (let lo = 0; lo < n; lo += run) {
    const hi = Math.min(lo + run, n)
    let zero = false
    a.subarray(lo, hi).sort((x, y) => {
      const c = cmp(x, y)
      if (c === 0) zero = true
      return c
    })
    // Neighbours can only be equal if the sort saw a 0 (it must, to order them).
    if (zero)
      for (let k = lo + 1; k < hi; k++) ea[k] = cmp(a[k - 1] as number, a[k] as number) ? 0 : 1
    yield
  }
  let b = new Uint32Array(n)
  let eb = new Uint8Array(n)
  let ops = 0
  for (let width = run; width < n; width *= 2) {
    for (let lo = 0; lo < n; lo += 2 * width) {
      const mid = Math.min(lo + width, n)
      const hi = Math.min(lo + 2 * width, n)
      let i = lo
      let j = mid
      // The run of the last output (-1: none yet) and whether it equals the other run's head.
      let prev = -1
      let same = 0
      for (let k = lo; k < hi; k++) {
        let c = 1
        let src: number
        if (i < mid && j < hi) {
          c = cmp(a[j] as number, a[i] as number)
          src = c < 0 ? 1 : 0
          if (++ops === CHUNK) {
            ops = 0
            yield
          }
        } else src = i < mid ? 0 : 1
        const p = src ? j++ : i++
        b[k] = a[p] as number
        eb[k] = prev === src ? (ea[p] as number) : prev < 0 ? 0 : same
        same = src === 0 && c === 0 ? 1 : 0
        prev = src
      }
    }
    const t = a
    a = b
    b = t
    const e = ea
    ea = eb
    eb = e
  }
  return { order: a, eq: ea }
}

/**
 * What the next {@link collationRanks} of the same column starts from (#95): the strings present
 * (`ids`: string → id, `rank`: id → rank) and one string per rank. Never mutated (a job builds a
 * new one), so a cancelled job leaves it usable.
 */
export interface RankState {
  readonly ids: ReadonlyMap<string, number>
  readonly rank: ArrayLike<number>
  readonly reps: readonly string[]
}

export interface Ranked {
  readonly ranks: Float64Array
  readonly state: RankState
}

/**
 * Collation ranks of a string column (§6.4, §9.1): per row, the dense rank of its string among
 * the column's distinct strings in `collator` order (strings the collator finds equal share a
 * rank), `NaN` for a missing value. Sorting by these numbers gives exactly the order of
 * `collator.compare`, with integer keys (counting / radix sort) instead of a collator call per
 * comparison. A time-sliced job; `null` when a present value is not a string.
 *
 * Incremental across data versions (#95): a string ranked in `prev` (the state of an earlier array
 * of the same column) keeps that rank as its sort key, a new one is placed among them by binary
 * search (equal to a rank, or in the gap below it). Only two new strings in the same gap call the
 * collator while sorting: a one-row edit costs O(log d) collator calls (and a sort of numbers), not
 * a cold sort. The new state holds only the strings present now.
 */
export function* collationRanks(
  values: readonly unknown[],
  collator: Intl.Collator,
  prev: RankState = { ids: new Map(), rank: [], reps: [] },
): Generator<undefined, Ranked | null, undefined> {
  const n = values.length
  const { ids: known, rank: knownRank, reps } = prev
  const ids = new Map<string, number>()
  const distinct: string[] = []
  /** Per distinct string: its rank in `prev`, or `g - 0.5` when new and between ranks g-1 and g. */
  const key: number[] = []
  /** Per row: its string's position in `distinct`, -1 when missing. */
  const slot = new Int32Array(n)
  let ops = 0
  let fresh = 0
  for (let r = 0; r < n; r++) {
    const v = values[r]
    if (typeof v === 'string') {
      let id = ids.get(v)
      if (id === undefined) {
        id = distinct.length
        ids.set(v, id)
        distinct.push(v)
        const p = known.get(v)
        let k = p === undefined ? p : knownRank[p]
        if (k === undefined) {
          fresh++
          let lo = 0
          let hi = reps.length
          while (lo < hi) {
            const mid = (lo + hi) >>> 1
            const c = collator.compare(v, reps[mid] as string)
            ops++
            if (c === 0) {
              k = mid
              break
            }
            if (c < 0) hi = mid
            else lo = mid + 1
          }
          k ??= lo - 0.5
        }
        key.push(k)
      }
      slot[r] = id
    } else if (typeRank(v) === RANK.missing) slot[r] = -1
    else return null
    if (++ops >= CHUNK) {
      ops = 0
      yield
    }
  }
  // The same strings as `prev` (a new array of equal content, rows moved): the same ranks.
  let rankOf: ArrayLike<number> = key
  let next = reps
  if (fresh > 0 || ids.size !== known.size) {
    const byCollator = (a: number, b: number) =>
      collator.compare(distinct[a] as string, distinct[b] as string)
    const { order, eq } = yield* sortPositions(
      distinct.length,
      // Cold: every string is new. Else two new strings in the same gap go to the collator.
      reps.length === 0
        ? byCollator
        : (a, b) => {
            const x = key[a] as number
            return x - (key[b] as number) || (x % 1 ? byCollator(a, b) : 0)
          },
      // Comparing numbers is far cheaper: longer native runs, fewer merge passes.
      reps.length === 0 ? RUN : 8 * RUN,
    )
    const dense = new Float64Array(distinct.length)
    const kept: string[] = []
    let rank = -1
    for (let k = 0; k < order.length; k++) {
      const id = order[k] as number
      if (!eq[k]) kept[++rank] = distinct[id] as string
      dense[id] = rank
      if (k % CHUNK === CHUNK - 1) yield
    }
    rankOf = dense
    next = kept
  }
  const out = new Float64Array(n)
  for (let r = 0; r < n; r++) {
    const id = slot[r] as number
    out[r] = id < 0 ? Number.NaN : (rankOf[id] as number)
  }
  return { ranks: out, state: { ids, rank: rankOf, reps: next } }
}
