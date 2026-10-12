import { debouncedSignal } from 'kk-debounce/debounceSignal'
import { throttle } from 'kk-debounce/throttle'
import { defineOptions } from '../../catalog/options'
import { defineFeature } from '../../feature/define'
import type { RowModelContext } from '../../feature/types'
import { defineInterceptor } from '../../intercept/define'
import { type DataMode, modeOption } from '../../source/mode'
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

/** A duration: milliseconds, or a kk-debounce temporal object (`{ seconds: 1, ms: 500 }`). */
export type SearchWait =
  | number
  | { hours?: number; minutes?: number; seconds?: number; ms?: number }

/** When `query` follows `input` (§6.3). */
export interface SearchTyping {
  /**
   * `'immediate'` (default): every keystroke is applied. `'debounce'`: applied after `wait` of
   * quiet (kk-debounce `debouncedSignal`). `'throttle'`: at most once per `wait` (the first
   * keystroke at once, the latest one at the end of the window).
   */
  strategy?: 'immediate' | 'debounce' | 'throttle'
  /** Default 300 ms. Used by `'debounce'` and `'throttle'`. */
  wait?: SearchWait
  /**
   * Debounce only. `'trailing'` (default): apply after the burst. `'leading'`: apply the first
   * keystroke at once and drop the rest of the burst (`flushSearch()` applies them).
   */
  behavior?: 'trailing' | 'leading'
  /** A trimmed input shorter than this is applied as an empty query (all rows). Default 0. */
  minLength?: number
  /** `'type'` (default): typing commits. `'enter'`: only `flushSearch()` commits. */
  commitOn?: 'type' | 'enter'
}

/** Client matching options (§6.3). */
export interface SearchOptions {
  /** Minimum relevance (0–1, weight applied) to keep a row. Default `0.3`. */
  threshold?: number
  /** Maximum Levenshtein distance for a fuzzy match. Default `3`. */
  fuzzyMaxDistance?: number
  /** Default `false`. */
  caseSensitive?: boolean
  /**
   * Typing timing: when `query` follows `input`. Default: immediate; with `mode: 'server'`,
   * debounce 300 ms and `minLength` 2 (§6.3).
   */
  typing?: SearchTyping
  /**
   * `'server'`: the server matches `query` (its state goes to `options.fetcher`, or the app
   * fetches); core skips this step (§7.1). Default `'client'`.
   */
  mode?: DataMode
  // Seams: `searchFn` / `useWorker` (T19).
}

const DEFAULT_WAIT = 300

const isDuration = (v: unknown): boolean => {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0
  for (const k of ['hours', 'minutes', 'seconds', 'ms'] as const) {
    const n = (v as Record<string, unknown>)[k]
    if (n !== undefined && !(typeof n === 'number' && Number.isFinite(n) && n >= 0)) return false
  }
  return true
}

const typingOptions = {
  strategy: { type: 'string', oneOf: ['immediate', 'debounce', 'throttle'] },
  wait: {
    type: ['number', 'object'],
    check: isDuration,
    expected: 'milliseconds >= 0 or { hours?, minutes?, seconds?, ms? } with values >= 0',
    noEffect: (_: unknown, o: Readonly<Record<string, unknown>>) =>
      o.commitOn === 'enter'
        ? "commitOn is 'enter': only flushSearch() commits"
        : o.strategy !== 'debounce' && o.strategy !== 'throttle'
          ? "only the 'debounce' and 'throttle' strategies wait"
          : undefined,
  },
  behavior: {
    type: 'string',
    oneOf: ['trailing', 'leading'],
    noEffect: (_: unknown, o: Readonly<Record<string, unknown>>) =>
      o.commitOn === 'enter'
        ? "commitOn is 'enter': only flushSearch() commits"
        : o.strategy !== 'debounce'
          ? "behavior applies to the 'debounce' strategy only"
          : undefined,
  },
  minLength: {
    type: 'number',
    check: (v: number) => Number.isInteger(v) && v >= 0,
    expected: 'a non-negative integer',
  },
  commitOn: { type: 'string', oneOf: ['type', 'enter'] },
} as const

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
  typing: { type: 'object', shape: typingOptions },
  mode: modeOption,
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
  const server = opts.mode === 'server'
  // Server defaults (§6.3): debounce, minLength 2. Filled in before the option check, so `wait` /
  // `behavior` alone are not reported as having no effect.
  const typing: SearchTyping = server
    ? { strategy: 'debounce', minLength: 2, ...opts.typing }
    : (opts.typing ?? {})
  const strategy = typing.commitOn === 'enter' ? 'enter' : (typing.strategy ?? 'immediate')
  const wait = typing.wait ?? DEFAULT_WAIT
  const minLength = typing.minLength ?? 0
  /** The query an input applies (a shorter trimmed input is no search). */
  const target = (input: string) => (input.trim().length < minLength ? '' : input)
  /** Per table: the scheduled commit (debounce / throttle), cancelled on `table:destroy`. */
  const timers = new WeakMap<object, { cancel(): void }>()

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
    mode: opts.mode ?? 'client',
    options: defineOptions(searchOptions, server ? { ...opts, typing } : opts),
    initialState: (): SearchState => ({ input: '', query: '', status: 'idle' }),
    interceptors: [
      defineInterceptor({
        name: 'search',
        on: ['table:destroy'],
        intercept(ctx, next) {
          timers.get(ctx.table as object)?.cancel()
          return next()
        },
      }),
    ],
    createApi: (ctx): SearchApi => {
      const outcome = (): Promise<SearchOutcome> => Promise.resolve({ status: 'applied' })
      const write = (input: string, query: string, status: SearchStatus) => {
        const s = ctx.getState()
        if (s?.input === input && s.query === query && s.status === status && !('error' in s)) {
          return
        }
        ctx.setState({ input, query, status })
      }
      /** Inside a strategy call: a synchronous apply is collected here (one update, not two). */
      let calling = false
      let appliedNow: string | undefined
      const apply = (query: string) => {
        if (calling) appliedNow = query
        else write(ctx.getState()?.input ?? '', query, 'idle')
      }
      const timer =
        strategy === 'debounce'
          ? debouncedSignal(() => ctx.getState()?.query ?? '', apply, wait, {
              behavior: typing.behavior ?? 'trailing',
            })
          : strategy === 'throttle'
            ? throttle(apply, wait)
            : undefined
      if (timer) timers.set(ctx.table, timer)

      /** Typing: `input` at once; `query` through the strategy (`pending` while scheduled). */
      const commit = (input: string) => {
        const current = ctx.getState()?.query ?? ''
        const query = target(input)
        if (strategy === 'enter') return write(input, current, 'idle')
        if (!timer || query === current) {
          timer?.cancel()
          return write(input, query, 'idle')
        }
        calling = true
        appliedNow = undefined
        try {
          timer(query)
        } finally {
          calling = false
        }
        if (appliedNow !== undefined) return write(input, appliedNow, 'idle')
        // A leading debounce drops the rest of the burst: nothing is scheduled to commit it (the
        // silence window keeps running; `flushSearch()` commits the input).
        if (strategy === 'debounce' && typing.behavior === 'leading') {
          return write(input, current, 'idle')
        }
        write(input, current, 'pending')
      }
      /** Applies `input` now (Enter, clear): any scheduled commit is dropped. */
      const applyNow = (input: string) => {
        timer?.cancel()
        write(input, target(input), 'idle')
      }
      return {
        setSearch: (query) => {
          commit(toText(query))
          return outcome()
        },
        flushSearch: () => {
          applyNow(ctx.getState()?.input ?? '')
          return outcome()
        },
        cancelSearch: () => {
          timer?.cancel()
          const s = ctx.getState()
          if (s?.status === 'pending') ctx.setState({ ...s, status: 'idle' })
        },
        clearSearch: () => applyNow(''),
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
