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
 * What the next {@link collationRanks} of the same column starts from (#95): the values it ranked,
 * their ranks (the `ranks` it returned, shared) and the distinct strings in rank order (one per
 * rank, shared with the data). No string → id map: a row whose string is unchanged at its position
 * (or at a shifted one) keeps its rank, any other string is found by binary search over `reps`.
 * Never mutated (a job builds a new one), so a cancelled job leaves it usable.
 */
export interface RankState {
  readonly values: readonly unknown[]
  readonly ranks: ArrayLike<number>
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
 * of the same column) keeps that rank as its sort key. It is read from the same row of `prev` when
 * the string is the same there (or at the row offset of the last match, for inserted / removed
 * rows), else found by binary search over the ranked strings; a new string is placed in the gap
 * below the first greater one. Only new strings are sorted (two in the same gap call the
 * collator): a one-row edit costs O(log d) collator calls (and a sort of numbers), not a cold
 * sort. The new state holds only the strings present now.
 */
export function* collationRanks(
  values: readonly unknown[],
  collator: Intl.Collator,
  prev: RankState = { values: [], ranks: [], reps: [] },
): Generator<undefined, Ranked | null, undefined> {
  const n = values.length
  const { values: was, ranks: wasRank, reps } = prev
  const m = reps.length
  /** Per row: its rank in `prev`, `m + id` for the new string `fresh[id]`, NaN when missing. */
  const out = new Float64Array(n)
  /** Ranks of `prev` still present (the rest are dropped from the new state). */
  const used = new Uint8Array(m)
  // New strings only (a cold job: every distinct string), dropped with the job.
  const freshIds = new Map<string, number>()
  const fresh: string[] = []
  /** Per new string: `g - 0.5`, between ranks g-1 and g of `prev`. */
  const gap: number[] = []
  /** Per rank of `prev`: one row holding it, built on the first lookup that finds one. */
  let rowOf: Int32Array | undefined
  /** Offset to `prev`'s row of the last match: rows inserted / removed above shift it. */
  let shift = 0
  let ops = 0
  for (let r = 0; r < n; r++) {
    const v = values[r]
    if (typeof v === 'string') {
      let k: number | undefined
      const q = r + shift
      // Out of range: `undefined`, never a string.
      if (was[q] === v) k = wasRank[q] as number
      else {
        const id = freshIds.get(v)
        if (id !== undefined) k = m + id
        else {
          let lo = 0
          let hi = m
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
          if (k === undefined) {
            k = m + fresh.length
            freshIds.set(v, fresh.length)
            fresh.push(v)
            gap.push(lo - 0.5)
          } else {
            if (!rowOf) {
              rowOf = new Int32Array(m)
              for (let p = 0; p < was.length; p++) {
                const x = wasRank[p] as number
                if (!Number.isNaN(x)) rowOf[x] = p
              }
            }
            shift = (rowOf[k] as number) - r
          }
        }
      }
      if (k < m) used[k] = 1
      out[r] = k
    } else if (typeRank(v) === RANK.missing) out[r] = Number.NaN
    else return null
    if (++ops >= CHUNK) {
      ops = 0
      yield
    }
  }
  // The same strings as `prev` (a new array of equal content, rows moved): the same ranks.
  if (!fresh.length && !used.includes(0)) return { ranks: out, state: { values, ranks: out, reps } }

  const f = fresh.length
  const { order, eq } = yield* sortPositions(
    f,
    // By gap; two new strings in the same gap (cold: all of them) go to the collator.
    (a, b) =>
      (gap[a] as number) - (gap[b] as number) ||
      collator.compare(fresh[a] as string, fresh[b] as string),
    // Comparing numbers is far cheaper: longer native runs, fewer merge passes.
    m ? 8 * RUN : RUN,
  )
  // Merge the kept ranks of `prev` and the new strings (each before the rank above its gap). No
  // collator call: one pass, like the rank lookup below.
  const remap = new Float64Array(m + f)
  const kept: string[] = []
  let rank = -1
  let j = 0
  for (let g = 0; g <= m; g++) {
    while (j < f && (gap[order[j] as number] as number) < g) {
      const id = order[j] as number
      if (!eq[j]) kept[++rank] = fresh[id] as string
      remap[m + id] = rank
      j++
    }
    if (g < m && used[g]) {
      kept[++rank] = reps[g] as string
      remap[g] = rank
    }
  }
  for (let r = 0; r < n; r++) {
    const k = out[r] as number
    if (!Number.isNaN(k)) out[r] = remap[k] as number
  }
  return { ranks: out, state: { values, ranks: out, reps: kept } }
}
