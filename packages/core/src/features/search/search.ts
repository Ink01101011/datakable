import { debouncedSignal } from 'kk-debounce/debounceSignal'
import { throttle } from 'kk-debounce/throttle'
import { optionDiagnostics } from '../../catalog/codes'
import { defineOptions } from '../../catalog/options'
import { throwConfigError } from '../../diagnostics/build'
import { keepDiagnostics } from '../../diagnostics/catalog'
import { DEV } from '../../diagnostics/env'
import { defineFeature } from '../../feature/define'
import type { AnyRow, RowModelContext } from '../../feature/types'
import { defineInterceptor } from '../../intercept/define'
import { runJob, sliced } from '../../pipeline/slice'
import { type DataMode, modeOption } from '../../source/mode'
import {
  APPLIED,
  type AsyncSearchFn,
  SEARCH_ENGINE,
  type SearchEngine,
  type SearchOutcome,
  type SearchSession,
  type SearchState,
  type SearchStatus,
  SUPERSEDED,
  type Waiter,
} from './search-fn-brand'
import { buildIndex, type MatchConfig, probeExSearch, type SearchIndex } from './search-index'

keepDiagnostics(optionDiagnostics)

export type {
  AsyncSearchFn,
  SearchFn,
  SearchFnContext,
  SearchOutcome,
  SearchResult,
  SearchState,
  SearchStatus,
} from './search-fn-brand'

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
export interface SearchOptions<T = AnyRow> {
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
  /**
   * Replaces the built-in matching (§6.3): called with each applied non-blank query; while it runs
   * `status` is `'searching'` and the previous results stay. A failure keeps them too
   * (`DK_SEARCH_FAILED`, `status: 'error'`); an `AbortError` is not a failure. New data runs it
   * again for the applied query. Wrap it with `withSearchFn()` from `@datakable/core/search-async`
   * (client search does not bundle the async engine): `searchFn: withSearchFn(fn)`.
   */
  searchFn?: AsyncSearchFn<T>
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

/** Built-in matching options do nothing when `searchFn` matches. */
const matching = (_: unknown, o: Readonly<Record<string, unknown>>) =>
  o.searchFn === undefined ? undefined : 'searchFn replaces the built-in matching'

const searchOptions = {
  threshold: {
    type: 'number',
    check: (v: number) => v >= 0 && v <= 1,
    expected: 'a number from 0 to 1',
    noEffect: matching,
  },
  fuzzyMaxDistance: {
    type: 'number',
    check: (v: number) => Number.isInteger(v) && v >= 0,
    expected: 'a non-negative integer',
    noEffect: matching,
  },
  caseSensitive: { type: 'boolean', noEffect: matching },
  typing: { type: 'object', shape: typingOptions },
  mode: modeOption,
  searchFn: {
    type: 'function',
    check: (v: object) => typeof (v as { [SEARCH_ENGINE]?: unknown })[SEARCH_ENGINE] === 'function',
    expected:
      "a function wrapped with withSearchFn() from '@datakable/core/search-async': " +
      'searchFn: withSearchFn(fn)',
    noEffect: (_: unknown, o: Readonly<Record<string, unknown>>) =>
      o.mode === 'server'
        ? "mode is 'server': the server (options.fetcher, or the app) matches the query"
        : undefined,
  },
} as const

const settledSuperseded = () => Promise.resolve(SUPERSEDED)

const toText = (q: unknown): string => (typeof q === 'string' ? q : q == null ? '' : String(q))

/**
 * Global search (§6.3), client mode: fuzzy matching with `ex-search` on the formatted values of the
 * searchable columns (`search: weight`; every column at weight 1 when none declares one).
 *
 * - The matcher is built on the first non-blank query, once per data + columns (not per keystroke),
 *   over the column cache's values; ex-search reads the projection `{ i, c0, c1, … }` one chunk of
 *   rows at a time, built while matching and not kept (§9.3 memory); results map back by index.
 * - A blank or whitespace-only query keeps every row. The query is trimmed before matching.
 * - Rows are ordered by relevance (score descending, ties by original index); a sort stage after
 *   search overrides that order.
 */
export const search = <T = AnyRow>(opts: SearchOptions<T> = {}) => {
  const config: MatchConfig = {
    threshold: opts.threshold ?? 0.3,
    fuzzyMaxDistance: opts.fuzzyMaxDistance ?? 3,
    caseSensitive: opts.caseSensitive ?? false,
  }
  /**
   * data → columns → the key of the projection job (`ctx.slice`, §9.1): its result is the index
   * (`null`: nothing searchable). Released with the data.
   */
  const indexes = new WeakMap<object, WeakMap<object, object>>()
  /** Job key → its finished index, also for runs without slicing (`explainRow` replays). */
  const built = new WeakMap<object, SearchIndex | null>()
  /** `ex-search` usable (probed once per feature instance, on the first build). */
  let useExSearch: boolean | undefined
  /** Columns references already reported as having no searchable column. */
  const reported = new WeakSet<object>()
  /** The last step: a slice change that keeps the query (typing, status) reuses its output. */
  let last:
    | { input: Uint32Array; query: string; index: SearchIndex; output: Uint32Array }
    | undefined
  /** The key of the latest matching job (one query over one set of rows). */
  let matching: { rows: Uint32Array; index: SearchIndex; query: string; key: object } | undefined
  /** The step's last output and its input: the stand-in while sliced work runs (§9.1). */
  let shown: { input: Uint32Array; output: Uint32Array } | undefined
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
  /** The async engine a `withSearchFn` searchFn brings (§6.3); `undefined` for client search. */
  const engine: SearchEngine | undefined = opts.searchFn?.[SEARCH_ENGINE]?.(opts.searchFn as never)
  // Never silent (§8.6): in production (no option validator) an unwrapped searchFn would be
  // ignored; in development the validator reports it at createTable(), with the full text.
  if (!DEV && opts.searchFn && !engine) {
    throwConfigError('DK_INVALID_OPTION', {
      path: 'searchFn',
      feature: 'search',
      expected: 'withSearchFn(searchFn)',
      received: 'searchFn',
      suggestions: [],
      phase: 'init',
    })
  }
  /** Per table: ends its timers, searches and waiters on `table:destroy`. */
  const instances = new WeakMap<object, () => void>()

  /** The projection of (data, columns): built by a sliced job; `undefined` while it runs. */
  function indexFor(ctx: RowModelContext): SearchIndex | null | undefined {
    let byColumns = indexes.get(ctx.data)
    if (!byColumns) {
      byColumns = new WeakMap()
      indexes.set(ctx.data, byColumns)
    }
    let key = byColumns.get(ctx.columns)
    if (key === undefined) {
      key = {}
      byColumns.set(ctx.columns, key)
    }
    const done = built.get(key)
    if (done !== undefined) return done
    useExSearch ??= probeExSearch(ctx.emit)
    const exSearch = useExSearch
    const index = sliced(ctx, key, () => buildIndex(ctx, config, exSearch))
    if (index !== undefined) built.set(key, index)
    return index
  }

  /** The ranked matches of `query` over `rows`: a sliced job; `undefined` while it runs. */
  function matchFor(
    ctx: RowModelContext,
    index: SearchIndex,
    rows: Uint32Array,
    query: string,
  ): Uint32Array | undefined {
    // A replay (`explainRow`) matches its one row at once, leaving the table's job alone.
    if (!ctx.slice) return runJob(() => index.match(rows, query))
    if (
      !matching ||
      matching.rows !== rows ||
      matching.index !== index ||
      matching.query !== query
    ) {
      matching = { rows, index, query, key: {} }
    }
    return sliced(ctx, matching.key, () => index.match(rows, query))
  }

  /** While sliced work runs: the previous output for the same input, else the input. */
  const standIn = (indices: Uint32Array) =>
    shown && shown.input === indices ? shown.output : indices

  /** The client step (§6.3); the rowModel below records its output for {@link standIn}. */
  function step(indices: Uint32Array, state: SearchState, ctx: RowModelContext): Uint32Array {
    const query = typeof state?.query === 'string' ? state.query.trim() : ''
    // ex-search returns [] for a blank query: blank means "no search".
    if (query === '') return indices
    if (engine) return engine.step(indices, ctx)
    const index = indexFor(ctx)
    // The projection is still being built (time-sliced, §9.1): the row model is 'pending'.
    if (index === undefined) return standIn(indices)
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
    // Search runs after filters: only the input rows are matched (order is re-ranked anyway).
    const output = matchFor(ctx, index, indices, query)
    if (output === undefined) return standIn(indices)
    last = { input: indices, query, index, output }
    return output
  }

  return defineFeature({
    name: 'search',
    stage: 'search',
    mode: opts.mode ?? 'client',
    options: defineOptions(
      // The option validator runs in development only (§9.3): production drops the schema.
      DEV ? searchOptions : ({} as typeof searchOptions),
      server ? { ...opts, typing } : opts,
    ),
    initialState: (): SearchState => ({ input: '', query: '', status: 'idle' }),
    // After destroy(): still a promise, so `setSearch(q).then(…)` never throws.
    destroyedResult: { setSearch: settledSuperseded, flushSearch: settledSuperseded },
    interceptors: [
      defineInterceptor({
        name: 'search',
        on: engine ? ['table:destroy', 'pipeline:run'] : ['table:destroy'],
        intercept(ctx, next) {
          const table = ctx.table as object
          if (ctx.op === 'table:destroy') {
            instances.get(table)?.()
            return next()
          }
          return (engine as SearchEngine).run(table, next)
        },
      }),
    ],
    createApi: (ctx): SearchApi => {
      const table = ctx.table as unknown as object
      const write = (input: string, query: string, status: SearchStatus, error?: unknown) => {
        const s = ctx.getState()
        if (
          status !== 'error' &&
          s?.input === input &&
          s.query === query &&
          s.status === status &&
          !('error' in s)
        ) {
          return
        }
        ctx.setState(
          status === 'error' ? { input, query, status, error } : { input, query, status },
        )
      }
      const applied = () => ctx.getState()?.query ?? ''
      const input = () => ctx.getState()?.input ?? ''

      // --- promise outcomes (§6.3): resolved when the query is applied, replaced, or failed ---
      /** Waiters of queries not handed to a search yet (typing, pending debounce, Enter mode). */
      let waiting: Waiter[] = []
      const waitFor = (query: string) =>
        new Promise<SearchOutcome>((resolve) => {
          waiting.push({ query, resolve })
        })
      /** Resolves the waiters of `query` with `outcome`, every other one `'superseded'`. */
      const settleWaiting = (query: string, outcome: SearchOutcome) => {
        const list = waiting
        waiting = []
        for (const w of list) w.resolve(w.query === query ? outcome : SUPERSEDED)
      }
      /** A newer query replaces the waiting ones that differ from it. */
      const replaceWaiting = (query: string) => {
        if (waiting.length === 0) return
        const keep: Waiter[] = []
        for (const w of waiting) {
          if (w.query === query) keep.push(w)
          else w.resolve(SUPERSEDED)
        }
        waiting = keep
      }

      /** Takes the waiters of `query`; every other waiting one resolves `'superseded'`. */
      const claim = (query: string) => {
        replaceWaiting(query)
        const keep = waiting
        waiting = []
        return keep
      }
      const session: SearchSession | undefined = engine?.session({
        ctx,
        write,
        applied,
        input,
        claim,
      })

      /**
       * Applies `query` (typing committed it, Enter, clear): at once, or with `searchFn` through a
       * request (the slice shows `'searching'`).
       */
      const applyQuery = (query: string, inp: string = input()) => {
        if (session?.apply(query, inp)) return
        write(inp, query, 'idle')
        settleWaiting(query, APPLIED)
      }

      // --- typing (T17) ---
      /** Inside a strategy call: a synchronous apply is collected here (one update, not two). */
      let calling = false
      let appliedNow: string | undefined
      const apply = (query: string) => {
        if (calling) appliedNow = query
        else applyQuery(query)
      }
      const timer =
        strategy === 'debounce'
          ? debouncedSignal(applied, apply, wait, { behavior: typing.behavior ?? 'trailing' })
          : strategy === 'throttle'
            ? throttle(apply, wait)
            : undefined
      /** The slice status while nothing new is applied: a search may still be in flight. */
      const resting = (): SearchStatus => (session?.busy() ? 'searching' : 'idle')

      instances.set(table, () => {
        timer?.cancel()
        session?.destroy()
        settleWaiting('\0', SUPERSEDED)
      })

      /** Typing: `input` at once; `query` through the strategy (`pending` while scheduled). */
      const commit = (next: string): Promise<SearchOutcome> => {
        const current = applied()
        const query = target(next)
        replaceWaiting(query)
        const p = waitFor(query)
        if (strategy === 'enter') {
          write(next, current, resting())
          return p
        }
        if (!timer || query === current) {
          timer?.cancel()
          applyQuery(query, next)
          return p
        }
        calling = true
        appliedNow = undefined
        try {
          timer(query)
        } finally {
          calling = false
        }
        if (appliedNow !== undefined) {
          applyQuery(appliedNow, next)
          return p
        }
        // A leading debounce drops the rest of the burst: nothing is scheduled to commit it (the
        // silence window keeps running; `flushSearch()` commits the input).
        if (strategy === 'debounce' && typing.behavior === 'leading') {
          write(next, current, resting())
          return p
        }
        write(next, current, 'pending')
        return p
      }
      /** Applies `input` now (Enter, clear): any scheduled commit is dropped. */
      const applyNow = (next: string): Promise<SearchOutcome> => {
        timer?.cancel()
        const query = target(next)
        replaceWaiting(query)
        const p = waitFor(query)
        applyQuery(query, next)
        return p
      }
      return {
        setSearch: (query) => commit(toText(query)),
        flushSearch: () => applyNow(input()),
        cancelSearch: () => {
          timer?.cancel()
          session?.abort()
          settleWaiting('\0', SUPERSEDED)
          const s = ctx.getState()
          if (s?.status === 'pending' || s?.status === 'searching') {
            ctx.setState({ input: s.input, query: s.query, status: 'idle' })
          }
        },
        clearSearch: () => {
          void applyNow('')
        },
      }
    },
    rowModel: (indices, state, ctx) => {
      const output = step(indices, state, ctx)
      shown = { input: indices, output }
      return output
    },
  })
}
