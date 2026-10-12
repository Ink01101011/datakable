import { ExSearch } from 'ex-search'
import type { Emit } from '../../diagnostics/types'
import type { RowModelContext } from '../../feature/types'
import { resolveColumns } from '../../pipeline/columns'
import { detectCapability } from '../../versioning/capability'

/** Matcher settings (the client options of `search()`, defaults applied). */
export interface MatchConfig {
  readonly threshold: number
  readonly fuzzyMaxDistance: number
  readonly caseSensitive: boolean
}

/**
 * One projected row: `i` is the row index (results map back by it, never by identity: ex-search
 * returns copies), `c0`, `c1`, … the formatted values of the searchable columns. Flat keys also
 * sidestep ex-search's top-level-key limitation for nested paths.
 */
export type Item = Record<string, string | number> & { readonly i: number }

/** A match: the row index and its relevance (0–1, weight applied). */
export interface Hit {
  readonly i: number
  readonly score: number
}

/** The projection of one (data, columns) pair and its matcher. */
export interface SearchIndex {
  /** One item per row of `data` (index = row index). */
  readonly items: readonly Item[]
  /**
   * A time-sliced job (§9.1) matching `query` (trimmed, non-blank) against `items` (all of them or
   * a subset), in chunks: the hits in relevance order ({@link rankHits}).
   */
  match(items: readonly Item[], query: string): Generator<undefined, Uint32Array, undefined>
}

/** Rows per chunk between two `yield`s of the projection and matching jobs. */
const CHUNK = 4096

interface Key {
  readonly name: string
  readonly weight: number
}

const hasExSearch = () =>
  typeof ExSearch === 'function' &&
  typeof ExSearch.prototype.search === 'function' &&
  typeof ExSearch.prototype.setData === 'function'

/** Feature-detects ex-search once (§8.5); `false` → the contains fallback. */
export function probeExSearch(emit: Emit): boolean {
  return detectCapability(
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
}

/**
 * Builds the projection from the column cache's formatted values (what the user sees), once per
 * data + columns, as a time-sliced job (§9.1): one column read per slice, then the items in chunks.
 * Searchable columns are those with a `search` weight > 0; when no column declares `search`, every
 * column is searchable at weight 1. `null` when nothing is searchable. Without `caseSensitive` the
 * values are lower-cased here, once, not on every query.
 */
export function* buildIndex(
  ctx: RowModelContext,
  config: MatchConfig,
  useExSearch: boolean,
): Generator<undefined, SearchIndex | null, undefined> {
  const cols = resolveColumns(ctx.columns)
  const declared = cols.list.some((c) => (c.def as { search?: unknown }).search !== undefined)
  const keys: Key[] = []
  const values: (readonly string[])[] = []
  for (const col of cols.list) {
    if (cols.byId.get(col.id) !== col) continue
    const w = (col.def as { search?: unknown }).search
    const weight = declared ? (typeof w === 'number' && w > 0 ? w : 0) : 1
    if (weight === 0) continue
    const formatted = ctx.getFormattedValues(col.id)
    if (!formatted) continue
    keys.push({ name: `c${keys.length}`, weight })
    values.push(formatted)
    yield
  }
  if (keys.length === 0) return null

  const fold = !config.caseSensitive
  const n = ctx.data.length
  const items = new Array<Item>(n)
  for (let r = 0; r < n; r++) {
    const o = { i: r } as Item
    for (let k = 0; k < keys.length; k++) {
      const v = (values[k] as readonly string[])[r] ?? ''
      ;(o as Record<string, string>)[(keys[k] as Key).name] = fold ? v.toLowerCase() : v
    }
    items[r] = o
    if (r % CHUNK === CHUNK - 1) yield
  }
  return useExSearch ? exSearchIndex(items, keys, config) : containsIndex(items, keys, config)
}

/** Matches `items` chunk by chunk (`score` decides alone, so chunks match like the whole). */
function* chunked(
  items: readonly Item[],
  matchChunk: (chunk: readonly Item[]) => readonly Hit[],
): Generator<undefined, Uint32Array, undefined> {
  if (items.length <= CHUNK) return rankHits(matchChunk(items))
  const hits: Hit[] = []
  for (let k = 0; k < items.length; k += CHUNK) {
    for (const h of matchChunk(items.slice(k, k + CHUNK))) hits.push(h)
    yield
  }
  return rankHits(hits)
}

function exSearchIndex(items: Item[], keys: readonly Key[], config: MatchConfig): SearchIndex {
  // Values are already folded when not case-sensitive (buildIndex), and so is the query below.
  const engine = new ExSearch<Item>({
    keys: keys.map((k) => ({ name: k.name, weight: k.weight })),
    threshold: config.threshold,
    fuzzyMaxDistance: config.fuzzyMaxDistance,
    caseSensitive: true,
    // DataKable re-ranks with exact scores and an index tie-break; tim keeps ex-search's own pass
    // stable and avoids radix's score quantisation.
    sortAlgorithm: 'tim',
  })
  let current: readonly Item[] = items
  engine.setData(items)
  return {
    items,
    match(subset, query) {
      const q = config.caseSensitive ? query : query.toLowerCase()
      return chunked(subset, (chunk) => {
        if (chunk !== current) {
          engine.setData(chunk as Item[])
          current = chunk
        }
        // Results are copies of the items (`Omit<Item, …>` drops `i` from the type, not the value).
        return engine.search(q) as unknown as readonly Hit[]
      })
    },
  }
}

/** The fallback when ex-search is missing or incompatible: exact 1 · prefix 0.8 · substring 0.65. */
function containsIndex(items: Item[], keys: readonly Key[], config: MatchConfig): SearchIndex {
  return {
    items,
    match(subset, query) {
      // Item values are folded already (buildIndex).
      const q = config.caseSensitive ? query : query.toLowerCase()
      return chunked(subset, (chunk) => {
        const hits: Hit[] = []
        for (const item of chunk) {
          let best = 0
          for (const k of keys) {
            const v = String(item[k.name] ?? '')
            const raw = v === q ? 1 : v.startsWith(q) ? 0.8 : v.includes(q) ? 0.65 : 0
            if (raw * k.weight > best) best = raw * k.weight
          }
          if (best > 0 && best >= config.threshold) hits.push({ i: item.i, score: best })
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
