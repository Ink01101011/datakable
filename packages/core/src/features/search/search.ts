import { debouncedSignal } from 'kk-debounce/debounceSignal'
import { throttle } from 'kk-debounce/throttle'
import { optionDiagnostics } from '../../catalog/codes'
import { defineOptions } from '../../catalog/options'
import { useDiagnostics } from '../../diagnostics/catalog'
import { describeValue } from '../../diagnostics/redact'
import { defineFeature } from '../../feature/define'
import type { AnyRow, RowModelContext } from '../../feature/types'
import { resolveRowKeys } from '../../ingest/row-key'
import { errorName } from '../../intercept/classify'
import { defineInterceptor } from '../../intercept/define'
import type { RowKey } from '../../pipeline/row'
import type { AsyncStatus } from '../../source/async-control'
import { type DataMode, modeOption } from '../../source/mode'
import { getTableInternals } from '../../table/internals'
import { searchDiagnostics } from './codes'
import {
  buildIndex,
  type Item,
  type MatchConfig,
  probeExSearch,
  rankHits,
  type SearchIndex,
} from './search-index'

useDiagnostics(searchDiagnostics, optionDiagnostics)

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

/** What `searchFn` receives (§6.3). */
export interface SearchFnContext<T> {
  /** The applied query, trimmed (never blank: a blank query shows every row without a call). */
  query: string
  /** The ingested rows (`table.getData()`); the result is intersected with the filtered ones. */
  rows: readonly T[]
  /** `options.columns` (empty when not given). */
  columns: readonly unknown[]
  /** Aborted when the request is superseded, cancelled, timed out or the table is destroyed. */
  signal: AbortSignal
}

/**
 * A `searchFn` result: the matching rows (references from `ctx.rows`) in relevance order, or their
 * row keys (`rowKey` values; row indices without a `rowKey`).
 */
export type SearchResult<T> = readonly T[] | { keys: readonly RowKey[] }

/** Custom / remote matching (§6.3). Runs through `async:request`: latest wins, abort, `timeout`. */
export type SearchFn<T> = (
  ctx: SearchFnContext<T>,
) => SearchResult<T> | PromiseLike<SearchResult<T>>

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
   * again for the applied query.
   */
  searchFn?: SearchFn<T>
}

const DEFAULT_WAIT = 300
const EMPTY: readonly never[] = []

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
    noEffect: (_: unknown, o: Readonly<Record<string, unknown>>) =>
      o.mode === 'server'
        ? "mode is 'server': the server (options.fetcher, or the app) matches the query"
        : undefined,
  },
} as const

/** A `searchFn` that rejected or threw: resolved as a value so asyncControl reports 'applied'. */
class SearchFailure {
  constructor(
    readonly error: unknown,
    readonly bad?: unknown,
  ) {}
}

const isAbortError = (e: unknown) =>
  e != null && typeof e === 'object' && (e as { name?: unknown }).name === 'AbortError'

async function callSearch(fn: SearchFn<unknown>, c: SearchFnContext<unknown>): Promise<unknown> {
  try {
    return await fn(c)
  } catch (e) {
    if (c.signal.aborted || isAbortError(e)) throw e
    return new SearchFailure(e)
  }
}

/** A `searchFn` result in one of its two shapes, or `undefined` when malformed. */
type Hits = { rows: readonly unknown[] } | { keys: readonly RowKey[] }
const toHits = (v: unknown): Hits | undefined =>
  Array.isArray(v)
    ? { rows: v }
    : v !== null && typeof v === 'object' && Array.isArray((v as { keys?: unknown }).keys)
      ? { keys: (v as { keys: readonly RowKey[] }).keys }
      : undefined

/** The applied `searchFn` result of a table, and its data indices per (data, rowKey). */
interface Applied {
  query: string
  /** The data `searchFn` searched. */
  data: readonly unknown[]
  hits: Hits
  cache?: { data: readonly unknown[]; rowKey: unknown; indices: Uint32Array }
}

/** What `setSearch` / `flushSearch` wait on. */
interface Waiter {
  query: string
  resolve: (o: SearchOutcome) => void
}

const APPLIED: SearchOutcome = Object.freeze({ status: 'applied' })
const SUPERSEDED: SearchOutcome = Object.freeze({ status: 'superseded' })
const settledSuperseded = () => Promise.resolve(SUPERSEDED)
const ERROR: SearchOutcome = Object.freeze({ status: 'error' })
const NO_KEYS = () => {}

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
export const search = <T = AnyRow>(opts: SearchOptions<T> = {}) => {
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
  const searchFn = opts.searchFn as SearchFn<unknown> | undefined
  /** Per table: ends its timers, searches and waiters on `table:destroy`; `check` after a run. */
  const instances = new WeakMap<object, { destroy(): void; check(): void }>()
  /** Per table: the applied `searchFn` result (the previous results while searching / on error). */
  const results = new WeakMap<object, Applied>()
  /** The table whose `pipeline:run` is in progress (`rowModel` has no table reference). */
  let active: object | undefined
  /** Data → row index, to map result rows back (rows are compared by identity). */
  const positions = new WeakMap<readonly unknown[], Map<unknown, number>>()
  let keyIndex: { data: readonly unknown[]; rowKey: unknown; map: Map<unknown, number> } | undefined

  /** The data indices of an applied result over `data`, in result order (memoised). */
  function indicesOf(a: Applied, data: readonly unknown[], rowKey: unknown): Uint32Array {
    const c = a.cache
    if (c && c.data === data && c.rowKey === rowKey) return c.indices
    let map: Map<unknown, number>
    let list: readonly unknown[]
    if ('rows' in a.hits) {
      list = a.hits.rows
      map = positions.get(data) ?? new Map()
      if (!positions.has(data)) {
        for (let i = 0; i < data.length; i++) if (!map.has(data[i])) map.set(data[i], i)
        positions.set(data, map)
      }
    } else {
      list = a.hits.keys
      if (!keyIndex || keyIndex.data !== data || keyIndex.rowKey !== rowKey) {
        // Diagnostics about the keys are the pipeline's (it resolves the same keys).
        const keyOf = resolveRowKeys(data, rowKey, NO_KEYS, NO_KEYS)
        const m = new Map<unknown, number>()
        for (let i = 0; i < data.length; i++) {
          const k = keyOf(data[i], i)
          if (!m.has(k)) m.set(k, i)
        }
        keyIndex = { data, rowKey, map: m }
      }
      map = keyIndex.map
    }
    const out = new Uint32Array(list.length)
    let n = 0
    for (const v of list) {
      const i = map.get(v)
      if (i !== undefined) out[n++] = i
    }
    const indices = out.subarray(0, n)
    a.cache = { data, rowKey, indices }
    return indices
  }

  /** The searchFn step: the input rows in the applied result, in its order (relevance). */
  function searchFnStep(input: Uint32Array, ctx: RowModelContext): Uint32Array {
    const a = active && results.get(active)
    // Nothing applied yet (the first search is in flight or failed): the rows stay unsearched.
    if (!a) return input
    const rowKey = (active as { getOptions(): { rowKey?: unknown } }).getOptions().rowKey
    const hits = indicesOf(a, ctx.data, rowKey)
    const take = new Uint8Array(ctx.data.length)
    for (let k = 0; k < input.length; k++) take[input[k] as number] = 1
    const out = new Uint32Array(Math.min(hits.length, input.length))
    let n = 0
    for (let k = 0; k < hits.length; k++) {
      const i = hits[k] as number
      if (take[i] === 1) {
        take[i] = 0
        out[n++] = i
      }
    }
    return out.subarray(0, n)
  }

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
    // After destroy(): still a promise, so `setSearch(q).then(…)` never throws.
    destroyedResult: { setSearch: settledSuperseded, flushSearch: settledSuperseded },
    interceptors: [
      defineInterceptor({
        name: 'search',
        on: searchFn ? ['table:destroy', 'pipeline:run'] : ['table:destroy'],
        intercept(ctx, next) {
          const table = ctx.table as object
          if (ctx.op === 'table:destroy') {
            instances.get(table)?.destroy()
            return next()
          }
          // `rowModel` reads the table's applied searchFn result through `active`.
          const prev = active
          active = table
          try {
            return next()
          } finally {
            active = prev
            instances.get(table)?.check()
          }
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

      // --- searchFn requests ---
      let dead = false
      /** The in-flight search: its query, data, waiters and abort handle. */
      let attempt:
        | { query: string; data: readonly unknown[]; waiters: Waiter[]; ctl: AbortController }
        | undefined
      /** (query, data) last handed to searchFn: `check()` never retries it in a loop. */
      let tried: { query: string; data: readonly unknown[] } | undefined
      let scheduled = false
      /**
       * SSR (§7.2): the initial query whose result is `initialData` (no searchFn call for it). Without
       * initialData, a deferred table (`createDeferred`) waits for `startTable` to search it.
       */
      let seeded: string | undefined
      if (searchFn && applied().trim() !== '') {
        const opts = ctx.table.getOptions()
        if (opts.initialData !== undefined && opts.data === undefined) seeded = applied()
        else getTableInternals(table).defer('searchFn')
      }

      /** Ends the in-flight search without its result (its waiters: `'superseded'`). */
      const abortAttempt = () => {
        const a = attempt
        if (!a) return
        attempt = undefined
        a.ctl.abort()
        for (const w of a.waiters) w.resolve(SUPERSEDED)
      }

      const startSearch = (query: string, inp: string) => {
        const data = ctx.table.getData() as readonly unknown[]
        const waiters: Waiter[] = []
        const prev = attempt
        if (prev) {
          attempt = undefined
          // Same query (new data): its waiters follow the new request; else they are replaced.
          if (prev.query === query) waiters.push(...prev.waiters)
          else for (const w of prev.waiters) w.resolve(SUPERSEDED)
          prev.ctl.abort()
        }
        for (const w of waiting) if (w.query === query) waiters.push(w)
        replaceWaiting(query)
        waiting = []
        const a = { query, data, waiters, ctl: new AbortController() }
        attempt = a
        tried = { query, data }
        write(inp, applied(), 'searching')
        const fn = searchFn as SearchFn<unknown>
        const c = {
          query: query.trim(),
          rows: data,
          columns: ctx.table.getOptions().columns ?? EMPTY,
        }
        getTableInternals(table)
          .request('searchFn', (signal) => callSearch(fn, { ...c, signal }), {
            signal: a.ctl.signal,
            onSettle: (value, status) => settle(a, value, status),
          })
          // strict: the DatakableError went to the hub; the outcome was settled in onSettle.
          .catch(() => settle(a, undefined, 'error'))
      }

      const settle = (a: NonNullable<typeof attempt>, value: unknown, status: AsyncStatus) => {
        // Replaced, cancelled or destroyed: its waiters were resolved then.
        if (attempt !== a || dead) return
        attempt = undefined
        const hits = status === 'applied' && !(value instanceof SearchFailure) && toHits(value)
        if (hits) {
          results.set(table, { query: a.query, data: a.data, hits })
          write(input(), a.query, 'idle')
          for (const w of a.waiters) w.resolve(APPLIED)
          return
        }
        if (status === 'superseded' || status === 'aborted') {
          // An AbortError from searchFn (not ours): not an error (§6.3).
          write(input(), applied(), 'idle')
          for (const w of a.waiters) w.resolve(SUPERSEDED)
          return
        }
        const failure = value instanceof SearchFailure ? value : undefined
        const error =
          status === 'timeout'
            ? new DOMException('searchFn timed out.', 'TimeoutError')
            : failure?.error
        write(input(), applied(), 'error', error)
        for (const w of a.waiters) w.resolve(ERROR)
        // 'error' / 'timeout': already reported by the errorBoundary / asyncControl.
        if (status !== 'applied') return
        const hadResults = results.has(table)
        if (failure) {
          const name = errorName(failure.error)
          ctx.emit(
            'DK_SEARCH_FAILED',
            { ...(name === undefined ? {} : { errorName: name }), hadResults },
            { cause: failure.error },
          )
        } else {
          ctx.emit('DK_SEARCH_FAILED', {
            problem: 'bad-result',
            received: describeValue(value),
            hadResults,
          })
        }
      }

      /**
       * Applies `query` (typing committed it, Enter, clear). Without `searchFn`, or for a blank
       * query, at once; with `searchFn`, through a request (the slice shows `'searching'`).
       */
      const applyQuery = (query: string, inp: string = input()) => {
        const data = ctx.table.getData()
        const r = results.get(table)
        const fresh = query === applied() && r?.query === query && r.data === data
        if (!searchFn || query.trim() === '' || fresh) {
          abortAttempt()
          if (query.trim() === '') results.delete(table)
          write(inp, query, 'idle')
          settleWaiting(query, APPLIED)
          return
        }
        if (attempt && attempt.query === query && attempt.data === data) {
          for (const w of waiting) if (w.query === query) attempt.waiters.push(w)
          replaceWaiting(query)
          waiting = []
          write(inp, applied(), 'searching')
          return
        }
        startSearch(query, inp)
      }

      /** After a pipeline run: new data or an outside query without a result → search again. */
      const check = () => {
        if (scheduled || dead) return
        const query = applied()
        if (query.trim() === '') return
        const data = ctx.table.getData()
        const r = results.get(table)
        if (r && r.query === query && r.data === data) return
        if (tried && tried.query === query && tried.data === data) return
        const internals = getTableInternals(table)
        if (seeded !== undefined) {
          const initial = seeded === query && internals.initialRows() === data
          seeded = undefined
          if (initial) {
            results.set(table, { query, data, hits: { rows: data } })
            return
          }
        }
        if (internals.defer('searchFn')) return
        scheduled = true
        queueMicrotask(() => {
          scheduled = false
          const q = applied()
          const d = ctx.table.getData()
          if (dead || q.trim() === '' || (tried && tried.query === q && tried.data === d)) return
          const cur = results.get(table)
          if (cur && cur.query === q && cur.data === d) return
          startSearch(q, input())
        })
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
      const resting = (): SearchStatus => (attempt ? 'searching' : 'idle')

      instances.set(table, {
        destroy() {
          dead = true
          timer?.cancel()
          abortAttempt()
          settleWaiting('\0', SUPERSEDED)
        },
        check,
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
          abortAttempt()
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
      const query = typeof state?.query === 'string' ? state.query.trim() : ''
      // ex-search returns [] for a blank query: blank means "no search".
      if (query === '') return indices
      if (searchFn) return searchFnStep(indices, ctx)
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
