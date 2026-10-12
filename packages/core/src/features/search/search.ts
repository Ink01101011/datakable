import { defineOptions } from '../../catalog/options'
import { defineFeature } from '../../feature/define'
import type { RowModelContext } from '../../feature/types'
import {
  buildIndex,
  type Item,
  type MatchConfig,
  probeExSearch,
  rankHits,
  type SearchIndex,
} from './search-index'

/**
 * `state.search.status` (§6.3): `'pending'` = a debounce is waiting (T17), `'searching'` = an async
 * `searchFn` is in flight (T19), `'error'` = it failed (previous results kept).
 */
export type SearchStatus = 'idle' | 'pending' | 'searching' | 'error'

/** The `search` slice (§6.3). */
export interface SearchState {
  /** What the user typed; updates immediately. */
  input: string
  /** The applied query (what the row model reflects). */
  query: string
  status: SearchStatus
  /** The last `searchFn` failure, when `status` is `'error'`. */
  error?: unknown
}

/** What `setSearch` / `flushSearch` resolve to; they never reject. */
export interface SearchOutcome {
  status: 'applied' | 'superseded' | 'error'
}

export interface SearchApi {
  /** Sets `input` (and `query`, with the client's immediate typing strategy). */
  setSearch(query: string): Promise<SearchOutcome>
  /** Applies the current `input` now (Enter). */
  flushSearch(): Promise<SearchOutcome>
  /** Drops a pending (debounced) query; `input` and the applied `query` stay. */
  cancelSearch(): void
  /** Empties `input` and `query`: every row is shown again. */
  clearSearch(): void
}

/** Client matching options (§6.3). */
export interface SearchOptions {
  /** Minimum relevance (0–1, weight applied) to keep a row. Default `0.3`. */
  threshold?: number
  /** Maximum Levenshtein distance for a fuzzy match. Default `3`. */
  fuzzyMaxDistance?: number
  /** Default `false`. */
  caseSensitive?: boolean
  // Seams: `typing` (T17), `searchFn` / `useWorker` (T19), `mode` (T21).
}

const searchOptions = {
  threshold: {
    type: 'number',
    check: (v: number) => v >= 0 && v <= 1,
    expected: 'a number from 0 to 1',
  },
  fuzzyMaxDistance: {
    type: 'number',
    check: (v: number) => Number.isInteger(v) && v >= 0,
    expected: 'a non-negative integer',
  },
  caseSensitive: { type: 'boolean' },
} as const

const toText = (q: unknown): string => (typeof q === 'string' ? q : q == null ? '' : String(q))

/**
 * Global search (§6.3), client mode: fuzzy matching with `ex-search` on the formatted values of the
 * searchable columns (`search: weight`; every column at weight 1 when none declares one).
 *
 * - The projection `{ i, c0, c1, … }` and the matcher are built on the first non-blank query, once
 *   per data + columns (not per keystroke); results map back to rows by index.
 * - A blank or whitespace-only query keeps every row. The query is trimmed before matching.
 * - Rows are ordered by relevance (score descending, ties by original index); a sort stage after
 *   search overrides that order.
 */
export const search = (opts: SearchOptions = {}) => {
  const config: MatchConfig = {
    threshold: opts.threshold ?? 0.3,
    fuzzyMaxDistance: opts.fuzzyMaxDistance ?? 3,
    caseSensitive: opts.caseSensitive ?? false,
  }
  /** data → columns → index (`null`: nothing searchable). Released with the data. */
  const indexes = new WeakMap<object, WeakMap<object, SearchIndex | null>>()
  /** `ex-search` usable (probed once per feature instance, on the first build). */
  let useExSearch: boolean | undefined
  /** Columns references already reported as having no searchable column. */
  const reported = new WeakSet<object>()
  /** The last step: a slice change that keeps the query (typing, status) reuses its output. */
  let last:
    | { input: Uint32Array; query: string; index: SearchIndex; output: Uint32Array }
    | undefined
  let subset: { input: Uint32Array; index: SearchIndex; items: readonly Item[] } | undefined

  function indexFor(ctx: RowModelContext): SearchIndex | null {
    let byColumns = indexes.get(ctx.data)
    if (!byColumns) {
      byColumns = new WeakMap()
      indexes.set(ctx.data, byColumns)
    }
    let index = byColumns.get(ctx.columns)
    if (index === undefined) {
      useExSearch ??= probeExSearch(ctx.emit)
      index = buildIndex(ctx, config, useExSearch)
      byColumns.set(ctx.columns, index)
    }
    return index
  }

  function itemsFor(input: Uint32Array, index: SearchIndex): readonly Item[] {
    // Search runs after filters: only the input rows are matched (order is re-ranked anyway).
    if (input.length === index.items.length) return index.items
    if (subset && subset.input === input && subset.index === index) return subset.items
    const items = new Array<Item>(input.length)
    for (let k = 0; k < input.length; k++) items[k] = index.items[input[k] as number] as Item
    subset = { input, index, items }
    return items
  }

  return defineFeature({
    name: 'search',
    stage: 'search',
    options: defineOptions(searchOptions, opts),
    initialState: (): SearchState => ({ input: '', query: '', status: 'idle' }),
    createApi: (ctx): SearchApi => {
      const outcome = (): Promise<SearchOutcome> => Promise.resolve({ status: 'applied' })
      /** Immediate strategy: `input` and `query` together. T17 puts the typing strategy here. */
      const commit = (input: string, query: string) => {
        const s = ctx.getState()
        if (s?.input === input && s.query === query && s.status === 'idle' && !('error' in s)) {
          return
        }
        ctx.setState({ input, query, status: 'idle' })
      }
      return {
        setSearch: (query) => {
          const q = toText(query)
          commit(q, q)
          return outcome()
        },
        flushSearch: () => {
          commit(ctx.getState()?.input ?? '', ctx.getState()?.input ?? '')
          return outcome()
        },
        cancelSearch: () => {
          const s = ctx.getState()
          if (s?.status === 'pending') ctx.setState({ ...s, status: 'idle' })
        },
        clearSearch: () => commit('', ''),
      }
    },
    rowModel: (indices, state, ctx) => {
      const query = typeof state?.query === 'string' ? state.query.trim() : ''
      // ex-search returns [] for a blank query: blank means "no search".
      if (query === '') return indices
      const index = indexFor(ctx)
      if (index === null) {
        if (!reported.has(ctx.columns)) {
          reported.add(ctx.columns)
          ctx.emit('DK_OPTION_NO_EFFECT', {
            path: 'query',
            feature: 'search',
            reason:
              'no column is searchable: pass `columns` (give the columns to search a `search` ' +
              'weight, or omit it everywhere to search every column)',
            once: false,
          })
        }
        return indices
      }
      if (last && last.input === indices && last.query === query && last.index === index) {
        return last.output
      }
      const output = rankHits(index.match(itemsFor(indices, index), query))
      last = { input: indices, query, index, output }
      return output
    },
  })
}
