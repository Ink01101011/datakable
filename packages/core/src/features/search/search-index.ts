import { ExSearch } from 'ex-search'
import { DEV } from '../../diagnostics/env'
import type { Emit } from '../../diagnostics/types'
import type { RowModelContext } from '../../feature/types'
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

/** Rows per chunk between two `yield`s of the matching job. */
const CHUNK = 4096

interface Key {
  readonly name: string
  readonly weight: number
}

/** The formatted value of row `r` of one searchable column. */
type Read = (r: number) => string

const hasExSearch = () =>
  typeof ExSearch === 'function' &&
  typeof ExSearch.prototype.search === 'function' &&
  typeof ExSearch.prototype.setData === 'function'

/** Feature-detects ex-search once (§8.5); `false` → the contains fallback. */
export function probeExSearch(emit: Emit): boolean {
  // DK_DEP_INCOMPATIBLE is a development check (§8.5); the fallback is not.
  return DEV
    ? detectCapability(
        hasExSearch,
        {
          feature: 'search',
          dependency: 'ex-search',
          capability: 'ExSearch',
          supported: '^1.1.1',
          fallback: 'case-insensitive exact / prefix / substring matching (no fuzzy matching)',
        },
        emit,
      )
    : hasCapability(hasExSearch)
}

/**
 * A numeric column's formatted value without the cached strings: `String(v)` is what the default
 * formatter shows for a number. Only when no value is `NaN` — a `NaN` cell is `null` / `undefined`
 * (shown as `''`) or a real `NaN` (shown as `'NaN'`), which only the formatted cache tells apart.
 */
function numberReader(values: Float64Array): Read | undefined {
  for (let r = 0; r < values.length; r++) if (Number.isNaN(values[r])) return undefined
  return (r) => String(values[r])
}

/**
 * Builds the matcher over the formatted values of the searchable columns (what the user sees), once
 * per data + columns, as a time-sliced job (§9.1): one column read per slice. Searchable columns are
 * those with a `search` weight > 0; when no column declares `search`, every column is searchable at
 * weight 1. `null` when nothing is searchable. The values are read from the column cache, never
 * copied (§9.3 memory): a numeric column without `format` is stringified while matching, and the
 * case is folded per chunk while matching.
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
    let read: Read | undefined
    if (!col.format) {
      const values = ctx.getColumnValues(col.id)
      if (values instanceof Float64Array) read = numberReader(values)
    }
    if (!read) {
      const formatted = ctx.getFormattedValues(col.id)
      if (!formatted) continue
      read = (r) => formatted[r] ?? ''
    }
    keys.push({ name: `c${keys.length}`, weight })
    reads.push(read)
    yield
  }
  if (keys.length === 0) return null
  const fold = !config.caseSensitive
  const at = (k: number, r: number) => {
    const v = (reads[k] as Read)(r)
    return fold ? v.toLowerCase() : v
  }
  return useExSearch
    ? exSearchIndex(ctx.data.length, keys, at, config)
    : containsIndex(keys, at, config)
}

/** Matches `rows` chunk by chunk (`score` decides alone, so chunks match like the whole). */
function* chunked(
  rows: Uint32Array,
  matchChunk: (chunk: Uint32Array) => readonly Hit[],
): Generator<undefined, Uint32Array, undefined> {
  if (rows.length <= CHUNK) return rankHits(matchChunk(rows))
  const hits: Hit[] = []
  for (let k = 0; k < rows.length; k += CHUNK) {
    for (const h of matchChunk(rows.subarray(k, k + CHUNK))) hits.push(h)
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
    get(t, p, receiver) {
      if (p === 'length') return length()
      const j = arrayIndex(p, length())
      return j >= 0 ? item(j) : Reflect.get(t, p, receiver)
    },
    has: (t, p) => arrayIndex(p, length()) >= 0 || Reflect.has(t, p),
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
  config: MatchConfig,
): SearchIndex {
  // Values are folded per chunk when not case-sensitive (buildIndex), and so is the query below.
  const engine = new ExSearch<Item>({
    keys: keys.map((k) => ({ name: k.name, weight: k.weight })),
    threshold: config.threshold,
    fuzzyMaxDistance: config.fuzzyMaxDistance,
    caseSensitive: true,
    // DataKable re-ranks with exact scores and an index tie-break; tim keeps ex-search's own pass
    // stable and avoids radix's score quantisation.
    sortAlgorithm: 'tim',
  })
  const view = projection(size, keys, at)
  engine.setData(view.items)
  return {
    match(rows, query) {
      const q = config.caseSensitive ? query : query.toLowerCase()
      return chunked(rows, (chunk) => {
        view.show(chunk)
        try {
          // Results are copies of the items (`Omit<Item, …>` drops `i` from the type, not the value).
          return engine.search(q) as unknown as readonly Hit[]
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
  config: MatchConfig,
): SearchIndex {
  return {
    match(rows, query) {
      // Values are folded per chunk (buildIndex).
      const q = config.caseSensitive ? query : query.toLowerCase()
      return chunked(rows, (chunk) => {
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
 * the order never depends on the matcher's own ranking.
 */
export function rankHits(hits: readonly Hit[]): Uint32Array {
  const n = hits.length
  const index = new Uint32Array(n)
  const score = new Float64Array(n)
  const order = new Uint32Array(n)
  for (let k = 0; k < n; k++) {
    const h = hits[k] as Hit
    index[k] = h.i
    score[k] = h.score
    order[k] = k
  }
  order.sort(
    (a, b) =>
      (score[b] as number) - (score[a] as number) || (index[a] as number) - (index[b] as number),
  )
  const out = new Uint32Array(n)
  for (let k = 0; k < n; k++) out[k] = index[order[k] as number] as number
  return out
}
