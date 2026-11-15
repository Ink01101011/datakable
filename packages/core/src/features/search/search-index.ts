import { canNarrow, ExSearch } from 'ex-search'
import { getValue } from '../../column/get-value'
import { DEV } from '../../diagnostics/env'
import type { Emit } from '../../diagnostics/types'
import type { RowModelContext } from '../../feature/types'
import { nullishOf, type SlicedFormatting } from '../../pipeline/column-cache'
import { resolveColumns } from '../../pipeline/columns'
import { detectCapability, hasCapability } from '../../versioning/capability'

/** Matcher settings (the client options of `search()`, defaults applied). */
export interface MatchConfig {
  readonly threshold: number
  readonly fuzzyMaxDistance: number
  readonly caseSensitive: boolean
}

/**
 * One projected row as ex-search reads it: `i` is the row index (results map back by it, never by
 * identity: ex-search returns copies), `c0`, `c1`, … the formatted values of the searchable
 * columns. Flat keys also sidestep ex-search's top-level-key limitation for nested paths. Items
 * are built while ex-search reads them and dropped after its call (§9.3 memory): none is kept.
 */
export type Item = Record<string, string | number> & { readonly i: number }

/** A match: the row index and its relevance (0–1, weight applied). */
export interface Hit {
  readonly i: number
  readonly score: number
}

/**
 * The scores of the last match of a table (#95), per data row: `h` the 53-bit hashes of the rows'
 * searched texts (the index's, `-1`: not hashed), `s` its score (`-1`: no hit, `NaN`: not matched).
 * 16 bytes per row.
 */
export interface Scores {
  /** The query. */
  readonly q: string
  /** The fuzzy distance, then the weights of the searched columns in key order. */
  readonly w: string
  readonly h: Float64Array
  readonly s: Float64Array
}

/** The matcher of one (data, columns) pair: references to column values, no per-row copy. */
export interface SearchIndex {
  /**
   * A time-sliced job (§9.1) matching `query` (trimmed, non-blank) against the rows `rows` (row
   * indices), in chunks: the hits in relevance order ({@link rankHits}). With `memo`, a row whose
   * searched texts hash like the same row of `memo.scores` (same position, or shifted by the
   * change in length: an insert or a delete) keeps its score and is not matched again (#95). On
   * the same data, a query that provably keeps no row the previous one dropped matches only the
   * previous hits (#96). `memo.scores` is then replaced by this match's.
   */
  match(
    rows: Uint32Array,
    query: string,
    memo?: { scores?: Scores },
  ): Generator<undefined, Uint32Array, undefined>
}

/** Rows per chunk between two `yield`s of a scan (one value per row). */
const CHUNK = 4096

/**
 * Cells (rows × searchable columns) matched per chunk between two `yield`s (#40): a table with
 * many searchable columns matches fewer rows per chunk, so a chunk stays a few milliseconds.
 */
const CELLS = 16_384

interface Key {
  readonly name: string
  readonly weight: number
}

/** The formatted value of row `r` of one searchable column. */
type Read = (r: number) => string

// A throw (no `ExSearch`) counts as missing (hasCapability). `canNarrow` comes with
// `search(q, { within })` (1.2.1 / 2.1.0), which matching relies on.
const hasExSearch = () =>
  [ExSearch.prototype.search, ExSearch.prototype.setData, ExSearch.prototype.canNarrow].every(
    (f) => typeof f === 'function',
  )

/** Feature-detects ex-search once (§8.5); `false` → the contains fallback. */
export function probeExSearch(emit: Emit): boolean {
  // DK_DEP_INCOMPATIBLE is a development check (§8.5); the fallback is not.
  return DEV
    ? detectCapability(
        hasExSearch,
        {
          feature: 'search',
          dependency: 'ex-search',
          capability: "ExSearch (fuzzyMode: 'word')",
          supported: '^2.1.1',
          fallback: 'case-insensitive exact / prefix / substring matching (no fuzzy matching)',
        },
        emit,
      )
    : hasCapability(hasExSearch)
}

/**
 * A numeric column's formatted value without cached strings (#27): what the default formatter
 * shows, `String(v)`, or `''` for a `null` / `undefined` cell (stored as `NaN`, like a real `NaN`,
 * which shows `'NaN'`).
 */
function numberReader(values: Float64Array): Read {
  const nullish = nullishOf(values)
  return (r) => {
    const v = values[r] as number
    return !Number.isNaN(v) ? String(v) : nullish?.[r] ? '' : 'NaN'
  }
}

/**
 * One pass over a column's values (`get(r)` per row, time-sliced by `CHUNK` rows): their text as
 * the default formatter shows a primitive (`String(v)`, `''` when nullish), read while matching
 * (#27: no formatted copy per row). `false` at the first object or function (a `Date`, an array):
 * the column cache formats those. `undefined` when a read throws. The values are read in NFC (#30),
 * normalised here, never per keystroke: the rows whose value is not NFC (rare: NFD input from
 * macOS, Thai or Vietnamese keyboards) keep their NFC form in a sparse map. Only values with a code
 * unit from U+0300 (combining marks and up) can change.
 */
function* scan(
  size: number,
  get: (r: number) => unknown,
): Generator<undefined, Read | false | undefined, undefined> {
  const over = new Map<number, string>()
  try {
    for (let r = 0; r < size; r++) {
      const v = get(r)
      if (v !== null && (typeof v === 'object' || typeof v === 'function')) return false
      if (typeof v === 'string' && /[\u0300-\uffff]/.test(v)) {
        const n = v.normalize('NFC')
        if (n !== v) over.set(r, n)
      }
      if (r % CHUNK === CHUNK - 1) yield
    }
  } catch {
    return undefined
  }
  const read: Read = (r) => {
    const v = get(r)
    return v === null || v === undefined ? '' : String(v)
  }
  return over.size ? (r) => over.get(r) ?? read(r) : read
}

/**
 * Builds the matcher over the formatted values of the searchable columns (what the user sees), once
 * per data + columns, as a time-sliced job (§9.1): one column read per slice. Searchable columns are
 * those with a `search` weight > 0. When no column declares `search`, the columns of primitives
 * (strings, numbers, booleans, nullable) are searchable at weight 1, and a column of dates, arrays
 * or other objects is not (#27: it would keep a formatted string per row; it opts in with a
 * weight; `DK_SEARCH_COLUMN_SKIPPED` in development). `null` when nothing is searchable. Nothing
 * is copied per row (§9.3 memory): a key column of primitives without `format` is read from the
 * rows and stringified while matching (no values array, #27); an accessor column of primitives
 * reads the column cache's values the same way; only a column with `format` or an opted-in object
 * column (dates, arrays) keeps its formatted strings in the column cache. A key column whose read
 * throws goes through the column cache too, which reports it. The case is folded per chunk while
 * matching.
 */
export function* buildIndex(
  ctx: RowModelContext,
  config: MatchConfig,
  useExSearch: boolean,
): Generator<undefined, SearchIndex | null, undefined> {
  const cols = resolveColumns(ctx.columns)
  const declared = cols.list.some((c) => (c.def as { search?: unknown }).search !== undefined)
  const data = ctx.data
  const n = data.length
  const keys: Key[] = []
  const reads: Read[] = []
  for (const col of cols.list) {
    if (cols.byId.get(col.id) !== col) continue
    const w = (col.def as { search?: unknown }).search
    const weight = declared ? (typeof w === 'number' && w > 0 ? w : 0) : 1
    if (weight === 0) continue
    const path = col.format ? undefined : col.path
    let failed = false
    const onError = () => {
      failed = true
    }
    let read = path ? yield* scan(n, (r) => getValue(data[r], path, onError)) : undefined
    if (failed || (read === false && declared)) read = undefined
    if (read === undefined) {
      const values = ctx.getColumnValues(col.id)
      if (!values) continue
      yield // reading a column is a task of its own (#40)
      const numbers = values instanceof Float64Array
      if (numbers && !col.format) read = numberReader(values)
      else {
        // Zero-config: a column of objects is not searched, `format` or not (#27).
        const own =
          numbers || (declared && col.format) ? undefined : yield* scan(n, (r) => values[r])
        if (own === false && !declared) read = false
        else if (own && !col.format) read = own
        else {
          // Time-sliced in a table run (#40): dates or a heavy `format` are not one long task.
          const sliced = (ctx as RowModelContext & SlicedFormatting).formattedSliced
          const formatted = sliced ? yield* sliced(col.id) : ctx.getFormattedValues(col.id)
          if (!formatted) continue
          read = yield* scan(n, (r) => formatted[r])
        }
      }
    }
    if (!read) {
      if (DEV && read === false) {
        ctx.emit('DK_SEARCH_COLUMN_SKIPPED', { column: col.id, index: col.index })
      }
      continue
    }
    keys.push({ name: `c${keys.length}`, weight })
    reads.push(read)
    yield
  }
  if (keys.length === 0) return null
  // The memo key of the kept scores (#95): the weights, and the distance they were matched with
  // (#123: data crossing `fuzzyMaxRows` changes it; scores of the other mode are never reused).
  const w = `${config.fuzzyMaxDistance};${keys.map((k) => k.weight)}`
  /**
   * A 53-bit hash of row `r`'s searched texts (#95), cyrb53: two 32-bit lanes over the code units
   * plus one (1–65536), each text closed by a 0 (`charCodeAt` past the end is `NaN`, read as 0 by
   * `^`), so two different lists of texts hash different sequences; the lanes are mixed at the end.
   * A changed row is compared with at most two stored hashes: the chance that it keeps a stale
   * score (a collision) is at most 2·2⁻⁵³ ≈ 2.2·10⁻¹⁶ per changed row (accepted for #95).
   */
  const hash = (r: number) => {
    let a = 0xdeadbeef
    let b = 0x41c6ce57
    for (const read of reads) {
      const v = read(r)
      for (let j = 0; j <= v.length; j++) {
        const c = v.charCodeAt(j) + 1
        a = Math.imul(a ^ c, 2654435761)
        b = Math.imul(b ^ c, 1597334677)
      }
    }
    a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909)
    b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909)
    return 4294967296 * (2097151 & b) + (a >>> 0)
  }
  // Values (NFC already) are folded per chunk while matching; the query is normalised as well, so
  // NFC and NFD spellings match each other like in the `contains` filter (#30).
  const fold = (v: string) => (config.caseSensitive ? v : v.toLowerCase())
  const foldQuery = (q: string) => fold(q.normalize('NFC'))
  const at = (k: number, r: number) => fold((reads[k] as Read)(r))
  /** Rows matched per slice. */
  const size = Math.max(256, Math.floor(CELLS / keys.length))
  /**
   * Rows per block (#96 a, word matching): half a slice, so building a block's word index (every
   * row read and split) and matching a run of it fit one slice (§9.1).
   */
  const block = size >> 1
  /** Rows matched between two `yield`s: a quarter slice, so a slice ends close to its deadline. */
  const run = size >> 2
  const matcher = (useExSearch ? exSearchMatcher : containsMatcher)(keys, at, config, n, block)
  /**
   * The hashes of this data version, computed on a row's first match (`-1`: not yet). The texts do
   * not depend on the query: a keystroke reuses them and hashes no row (#95).
   */
  const h = new Float64Array(n).fill(-1)
  return {
    *match(rows, query, memo) {
      const q = foldQuery(query)
      const prev = memo?.scores
      const old = prev?.q === query && prev.w === w ? prev : undefined
      const d = old ? old.h.length - n : 0
      // Same data (the scores hold this index's hashes), a narrowing query: a row the previous
      // match scored without a hit is not matched again; its hits and the rows it did not see
      // (`NaN`: filtered out then) are.
      const cut = !old && prev?.h === h && prev.w === w && matcher.narrows?.(foldQuery(prev.q), q)
      const s = new Float64Array(n).fill(Number.NaN)
      const hits: Hit[] = []
      /** Rows read since the last `yield`: matched, or read to build a block's word index. */
      let spent = 0
      // Runs of at most `run` rows of one block, in the order given (a filter's output: ascending),
      // a `yield` between two (the slice ends close to its deadline, §9.1).
      for (let k = 0; k < rows.length; ) {
        const b = Math.floor((rows[k] as number) / block)
        let e = k + 1
        while (e < rows.length && e - k < run && Math.floor((rows[e] as number) / block) === b) e++
        const cost = e - k + (matcher.cost?.(b, q) ?? 0)
        if (spent && spent + cost > run) {
          yield
          spent = 0
        }
        spent += cost
        const chunk = rows.subarray(k, e)
        k = e
        const miss: number[] = []
        for (const r of chunk) {
          let x = h[r] as number
          if (x < 0) {
            x = hash(r)
            h[r] = x
          }
          s[r] = -1
          if (cut) {
            if ((prev.s[r] as number) !== -1) miss.push(r)
            continue
          }
          if (!old) continue
          // Out of range reads `undefined`: never equal, never `>= -1` (like `NaN`: not matched).
          const j = old.h[r] === x ? r : old.h[r + d] === x ? r + d : -1
          const v = old.s[j] as number
          if (v >= -1) {
            s[r] = v
            if (v >= 0) hits.push({ i: r, score: v })
          } else miss.push(r)
        }
        // A new query (no scores to keep) matches the chunk as it is.
        const todo = old || cut ? Uint32Array.from(miss) : chunk
        if (todo.length) {
          for (const hit of matcher(b, todo, q)) {
            s[hit.i] = hit.score
            hits.push(hit)
          }
        }
      }
      if (memo) memo.scores = { q: query, w, h, s }
      return rankHits(hits)
    },
  }
}

/**
 * The hits among `rows` (row indices, all in block `b`) for a folded query (`score` decides alone,
 * so parts match like the whole).
 */
type Matcher = ((b: number, rows: Uint32Array, query: string) => Hit[]) & {
  /** Rows read to build block `b`'s word index before `query` is matched there. Missing: none. */
  cost?: (b: number, query: string) => number
  /**
   * #96 (c): matching `next` within the hits of `prev` (both folded, as ex-search scores them)
   * provably equals matching every row. Missing: never.
   */
  narrows?: (prev: string, next: string) => boolean
}

function exSearchMatcher(
  keys: readonly Key[],
  at: (k: number, r: number) => string,
  config: MatchConfig,
  n: number,
  size: number,
): Matcher {
  // Values and query are folded already (buildIndex).
  const base = {
    keys: keys as Key[],
    ...config,
    caseSensitive: true,
    // DataKable re-ranks with exact scores and an index tie-break; tim keeps ex-search's own pass
    // stable and avoids radix's score quantisation.
    sortAlgorithm: 'tim' as const,
  }
  // A one-word query is measured against the whole value and each of its words, the best wins: a
  // typo of one word of a multi-word cell matches (#10). ex-search's `fuzzyMode: 'word'` does it
  // with its bounded matcher (#106). A query with whitespace is measured against whole values only,
  // as before (a single word is never that query), and is decided once per query, not per row (#96).
  // With `fuzzyMaxDistance: 0` no word can score (distance 0 is equality, which the exact and
  // contains tiers score already): values are not split at all, same results (#96).
  const words = (q: string) => config.fuzzyMaxDistance > 0 && !/\s/.test(q)
  /**
   * An engine and the data it reads: an array-like `{ length }` holding the `{ i, c0, … }` items of
   * one call's rows, row `r` at `r - start`, while the call runs, and none after it (§9.3 memory:
   * emptied, it keeps no element store). ex-search 2.x reads a row once per key and again for each
   * result: a plain object is read about twice as fast as a Proxy building each item on read (and
   * an array would keep 8 bytes per row); items from offset 0 up keep fast elements.
   */
  type Engine = { items: Item[]; engine: ExSearch<Item> }
  const engine = (length: number, fuzzyMode: 'value' | 'word'): Engine => {
    const items = { length } as unknown as Item[]
    return { items, engine: new ExSearch<Item>({ ...base, fuzzyMode }).setData(items) }
  }
  /** Rows `rows` matched by `e`, row `r` at `r - start` of its data; `read`: the rows it reads. */
  const run = (
    { items, engine }: Engine,
    rows: Uint32Array,
    read: Uint32Array,
    start: number,
    q: string,
  ) => {
    for (const r of read) {
      const o = { i: r } as Record<string, string | number>
      for (let k = 0; k < keys.length; k++) o[(keys[k] as Key).name] = at(k, r)
      items[r - start] = o as Item
    }
    try {
      // Results are copies of the items (`Omit<Item, …>` drops `i` from the type, not the value).
      return engine.search(q, { within: rows.map((r) => r - start) }) as unknown as Hit[]
    } finally {
      // `delete`: an `undefined` element would keep the element store.
      for (const r of read) delete items[r - start]
    }
  }
  /** Whole values: one engine over every row (made on first use), each call from its first row. */
  let whole: Engine | undefined
  // #96 (a): ex-search splits the values into words once per `setData`, on the first word-mode
  // search, and keeps the word offsets (its word index: about 1.6 bytes per value in 2.1.1, none for
  // a value of one word). Only word matching has blocks: one word engine per block of rows, made on
  // first use; a block's words are split in one slice (§9.1) the first time a one-word query
  // matches there, and later keystrokes over this data version split nothing. Never `updateConfig`
  // on it: that drops the index.
  const blocks: Engine[] = []
  const length = (b: number) => Math.min(size, n - b * size)
  const match: Matcher = (b, rows, q) => {
    if (!words(q)) {
      whole = whole ?? engine(n, 'value')
      return run(whole, rows, rows, Math.min(...rows), q)
    }
    const start = b * size
    // A new word engine builds its word index in this call: it reads every row of the block.
    const read = blocks[b] ? rows : Uint32Array.from({ length: length(b) }, (_, j) => start + j)
    const k = blocks[b] ?? engine(length(b), 'word')
    blocks[b] = k
    return run(k, rows, read, start, q)
  }
  match.cost = (b, q) => (words(q) && !blocks[b] ? length(b) : 0)
  // ex-search's `canNarrow`: fuzzy matching off, `prev` inside `next` and no weight that lets a row
  // reach `threshold` on `next` but not on `prev`; or the same query. Queries are compared as
  // DataKable scores them (trimmed, NFC, folded).
  match.narrows = (prev, next) => canNarrow(prev, next, base)
  return match
}

/** The fallback when ex-search is missing or incompatible: exact 1 · prefix 0.8 · substring 0.65. */
function containsMatcher(
  keys: readonly Key[],
  at: (k: number, r: number) => string,
  config: MatchConfig,
): Matcher {
  return (_, rows, q) => {
    const hits: Hit[] = []
    for (let j = 0; j < rows.length; j++) {
      const r = rows[j] as number
      let best = 0
      for (let k = 0; k < keys.length; k++) {
        const v = at(k, r)
        const raw = v === q ? 1 : v.startsWith(q) ? 0.8 : v.includes(q) ? 0.65 : 0
        const w = (keys[k] as Key).weight
        if (raw * w > best) best = raw * w
      }
      if (best > 0 && best >= config.threshold) hits.push({ i: r, score: best })
    }
    return hits
  }
}

/**
 * Hits in relevance order (§6.3): score descending, ties by original row index. Enforced here so
 * the order never depends on the matcher's own ranking. Sorts `hits` (a fresh array) in place.
 */
export function rankHits(hits: Hit[]): Uint32Array {
  return Uint32Array.from(
    hits.sort((a, b) => b.score - a.score || a.i - b.i),
    (h) => h.i,
  )
}
