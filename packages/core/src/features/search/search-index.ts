import { ExSearch, Scorer } from 'ex-search'
import { DEV } from '../../diagnostics/env'
import type { Emit } from '../../diagnostics/types'
import type { RowModelContext } from '../../feature/types'
import { nullishOf, type SlicedFormatting } from '../../pipeline/column-cache'
import { resolveColumns } from '../../pipeline/columns'
import { arrayIndex } from '../../pipeline/row'
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
 * are built per chunk while matching and dropped after it (§9.3 memory): none is kept.
 */
export type Item = Record<string, string | number> & { readonly i: number }

/** A match: the row index and its relevance (0–1, weight applied). */
export interface Hit {
  readonly i: number
  readonly score: number
}

/** The matcher of one (data, columns) pair: references to column values, no per-row copy. */
export interface SearchIndex {
  /**
   * A time-sliced job (§9.1) matching `query` (trimmed, non-blank) against the rows `rows` (row
   * indices), in chunks: the hits in relevance order ({@link rankHits}).
   */
  match(rows: Uint32Array, query: string): Generator<undefined, Uint32Array, undefined>
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

// A throw (no `ExSearch`) counts as missing (hasCapability).
const hasExSearch = () =>
  [ExSearch.prototype.search, ExSearch.prototype.setData, Scorer.fuzzy].every(
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
          capability: 'ExSearch, Scorer.fuzzy',
          supported: '^1.1.1',
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
 * A column of primitives (strings, numbers, booleans, … mixed or not) without `format`: its formatted
 * value read on the fly (#27), as the default formatter shows it (`String(v)`, `''` when nullish),
 * instead of a cached string per row. `undefined` when a value is an object (a `Date`, an array):
 * those are formatted once, by the column cache.
 */
function primitiveReader(values: readonly unknown[]): Read | undefined {
  for (const v of values) {
    if (v !== null && (typeof v === 'object' || typeof v === 'function')) return undefined
  }
  return (r) => {
    const v = values[r]
    return v === null || v === undefined ? '' : String(v)
  }
}

/**
 * Reads one column's values in NFC (#30), normalised once here, never per keystroke: the rows whose
 * value is not NFC (rare: NFD input from macOS, Thai or Vietnamese keyboards) keep their NFC form
 * in a sparse map; every other row reads through `read` unchanged. Only values with a code unit
 * from U+0300 (combining marks and up) can change. Time-sliced by `CHUNK` rows.
 */
function* nfc(size: number, read: Read): Generator<undefined, Read, undefined> {
  const over = new Map<number, string>()
  for (let r = 0; r < size; r++) {
    const v = read(r)
    const n = /[\u0300-\uffff]/.test(v) ? v.normalize('NFC') : v
    if (n !== v) over.set(r, n)
    if (r % CHUNK === CHUNK - 1) yield
  }
  return over.size ? (r) => over.get(r) ?? read(r) : read
}

/**
 * Builds the matcher over the formatted values of the searchable columns (what the user sees), once
 * per data + columns, as a time-sliced job (§9.1): one column read per slice. Searchable columns are
 * those with a `search` weight > 0; when no column declares `search`, every column is searchable at
 * weight 1. `null` when nothing is searchable. The values are read from the column cache, never
 * copied (§9.3 memory): a column of numbers or other primitives without `format` is stringified
 * while matching (no formatted strings are cached for it, #27), and the case is folded per chunk
 * while matching. Only a column with `format` or with object values (dates, arrays) keeps its
 * formatted strings in the column cache.
 */
export function* buildIndex(
  ctx: RowModelContext,
  config: MatchConfig,
  useExSearch: boolean,
): Generator<undefined, SearchIndex | null, undefined> {
  const cols = resolveColumns(ctx.columns)
  const declared = cols.list.some((c) => (c.def as { search?: unknown }).search !== undefined)
  const keys: Key[] = []
  const reads: Read[] = []
  for (const col of cols.list) {
    if (cols.byId.get(col.id) !== col) continue
    const w = (col.def as { search?: unknown }).search
    const weight = declared ? (typeof w === 'number' && w > 0 ? w : 0) : 1
    if (weight === 0) continue
    let read: Read
    const values = col.format ? undefined : ctx.getColumnValues(col.id)
    if (values) yield // reading a column is a task of its own (#40)
    if (values instanceof Float64Array) read = numberReader(values)
    else {
      let raw = values && primitiveReader(values)
      if (!raw) {
        // Time-sliced in a table run (#40): dates or a heavy `format` are not one long task.
        const sliced = (ctx as RowModelContext & SlicedFormatting).formattedSliced
        const formatted = sliced ? yield* sliced(col.id) : ctx.getFormattedValues(col.id)
        if (!formatted) continue
        raw = (r) => formatted[r] ?? ''
      }
      read = yield* nfc(ctx.data.length, raw)
    }
    keys.push({ name: `c${keys.length}`, weight })
    reads.push(read)
    yield
  }
  if (keys.length === 0) return null
  // Values (NFC already) are folded per chunk while matching; the query is normalised as well, so
  // NFC and NFD spellings match each other like in the `contains` filter (#30).
  const fold = (v: string) => (config.caseSensitive ? v : v.toLowerCase())
  const foldQuery = (q: string) => fold(q.normalize('NFC'))
  const at = (k: number, r: number) => fold((reads[k] as Read)(r))
  return useExSearch
    ? exSearchIndex(ctx.data.length, keys, at, foldQuery, config)
    : containsIndex(keys, at, foldQuery, config)
}

/** Matches `rows` chunk by chunk (`score` decides alone, so chunks match like the whole). */
function* chunked(
  rows: Uint32Array,
  columns: number,
  matchChunk: (chunk: Uint32Array) => Hit[],
): Generator<undefined, Uint32Array, undefined> {
  const size = Math.max(256, Math.floor(CELLS / columns))
  if (rows.length <= size) return rankHits(matchChunk(rows))
  const hits: Hit[] = []
  for (let k = 0; k < rows.length; k += size) {
    for (const h of matchChunk(rows.subarray(k, k + size))) hits.push(h)
    yield
  }
  return rankHits(hits)
}

/**
 * The projection as ex-search reads it: an array (iteration, `length`, index reads) of `{ i, c0, … }`
 * items, each built when read and not kept. It shows every row of `data` (`size`), or one chunk of
 * rows while that chunk is matched; ex-search holds this one view (`setData` once).
 */
function projection(size: number, keys: readonly Key[], at: (k: number, r: number) => string) {
  let rows: Uint32Array | undefined
  // Never written, and its own `length` stays 0: `length` is read through the trap below (setting
  // a large `length` would allocate a backing store).
  const target: Item[] = []
  const length = () => (rows ? rows.length : size)
  const item = (j: number): Item => {
    const r = rows ? (rows[j] as number) : j
    const o = { i: r } as Record<string, string | number>
    for (let k = 0; k < keys.length; k++) o[(keys[k] as Key).name] = at(k, r)
    return o as Item
  }
  const items = new Proxy(target, {
    get(t, p) {
      if (p === 'length') return length()
      const j = arrayIndex(p, length())
      return j >= 0 ? item(j) : t[p as keyof Item[]]
    },
    has: (t, p) => arrayIndex(p, length()) >= 0 || p in t,
  })
  return {
    items,
    /** Shows `chunk` (row indices), or every row again (`undefined`). */
    show(chunk: Uint32Array | undefined) {
      rows = chunk
    },
  }
}

function exSearchIndex(
  size: number,
  keys: readonly Key[],
  at: (k: number, r: number) => string,
  fold: (v: string) => string,
  config: MatchConfig,
): SearchIndex {
  // Values and query are folded already (buildIndex).
  const engine = new ExSearch<Item>({
    keys: keys as Key[],
    ...config,
    caseSensitive: true,
    // DataKable re-ranks with exact scores and an index tie-break; tim keeps ex-search's own pass
    // stable and avoids radix's score quantisation.
    sortAlgorithm: 'tim',
  })
  // ex-search measures the edit distance to the whole value, so a typo of one word of a multi-word
  // cell never matched (#10). For a one-word query, a value without it is shown as the best fuzzy
  // match of itself and its words, or as '' (scores 0, as the value would). A value with the query
  // stays whole for the exact / prefix / substring scores. Only strings within `max` of the query's
  // length are measured (an edit distance is at least the length difference).
  const max = config.fuzzyMaxDistance
  let q = ''
  const near = (k: number, r: number) => {
    const v = at(k, r)
    if (v.includes(q) || /\s/.test(q)) return v
    let best = ''
    let top = 0
    const words = v.split(/\s+/)
    for (const w of words[1] ? [v, ...words] : words) {
      const s = Math.abs(w.length - q.length) > max ? 0 : Scorer.fuzzy(w, q, max, true)
      if (s > top) {
        best = w
        top = s
      }
    }
    return best
  }
  const view = projection(size, keys, near)
  engine.setData(view.items)
  return {
    match(rows, query) {
      const folded = fold(query)
      return chunked(rows, keys.length, (chunk) => {
        // Set per chunk, like the view: another job may have matched in between.
        q = folded
        view.show(chunk)
        try {
          // Results are copies of the items (`Omit<Item, …>` drops `i` from the type, not the value).
          return engine.search(q) as unknown as Hit[]
        } finally {
          view.show(undefined)
        }
      })
    },
  }
}

/** The fallback when ex-search is missing or incompatible: exact 1 · prefix 0.8 · substring 0.65. */
function containsIndex(
  keys: readonly Key[],
  at: (k: number, r: number) => string,
  fold: (v: string) => string,
  config: MatchConfig,
): SearchIndex {
  return {
    match(rows, query) {
      const q = fold(query)
      return chunked(rows, keys.length, (chunk) => {
        const hits: Hit[] = []
        for (let j = 0; j < chunk.length; j++) {
          const r = chunk[j] as number
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
      })
    },
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
