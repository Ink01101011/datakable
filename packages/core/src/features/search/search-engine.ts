import { keepDiagnostics } from '../../diagnostics/catalog'
import { describeValue } from '../../diagnostics/redact'
import type { RowModelContext } from '../../feature/types'
import { resolveRowKeys } from '../../ingest/row-key'
import { errorName } from '../../intercept/classify'
import type { RowKey } from '../../pipeline/row'
import type { AsyncStatus } from '../../source/async-control'
import { requestsOf } from '../../source/requests'
import { getTableInternals } from '../../table/internals'
import { searchDiagnostics } from './codes'
import {
  APPLIED,
  type SearchEngine,
  type SearchFn,
  type SearchFnContext,
  type SearchHost,
  type SearchOutcome,
  type SearchSession,
  SUPERSEDED,
  type Waiter,
} from './search-fn-brand'

keepDiagnostics(searchDiagnostics)

const EMPTY: readonly never[] = []
const ERROR: SearchOutcome = Object.freeze({ status: 'error' })
const NO_KEYS = () => {}

/** A `searchFn` that rejected or threw: resolved as a value so asyncControl reports 'applied'. */
class SearchFailure {
  constructor(readonly error: unknown) {}
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

/**
 * The async search engine of one `search({ searchFn: withSearchFn(fn) })` feature instance (§6.3):
 * each applied non-blank query runs `fn` through `async:request` (latest wins, abort, `timeout`);
 * while it runs `status` is `'searching'` and the previous results stay; a failure keeps them too
 * (`DK_SEARCH_FAILED`, `status: 'error'`); new data runs it again for the applied query.
 */
export function createSearchEngine(fn: SearchFn<unknown>): SearchEngine {
  /** Per table: the applied `searchFn` result (the previous results while searching / on error). */
  const results = new WeakMap<object, Applied>()
  /** Per table: `check` after a pipeline run. */
  const checks = new WeakMap<object, () => void>()
  /** The table whose `pipeline:run` is in progress (`rowModel` has no table reference). */
  let active: object | undefined
  /** Data → row index, to map result rows back (rows are compared by identity). */
  const positions = new WeakMap<readonly unknown[], Map<unknown, number>>()
  let keyIndex: { data: readonly unknown[]; rowKey: unknown; map: Map<unknown, number> } | undefined
  /** The last step: same input and hits → same output (no per-run allocation). */
  let last: { input: Uint32Array; hits: Uint32Array; output: Uint32Array } | undefined

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

  function step(input: Uint32Array, ctx: RowModelContext): Uint32Array {
    const a = active && results.get(active)
    // Nothing applied yet (the first search is in flight or failed): the rows stay unsearched.
    if (!a) return input
    const rowKey = (active as { getOptions(): { rowKey?: unknown } }).getOptions().rowKey
    const hits = indicesOf(a, ctx.data, rowKey)
    if (last && last.input === input && last.hits === hits) return last.output
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
    const output = out.subarray(0, n)
    last = { input, hits, output }
    return output
  }

  function run<R>(table: object, next: () => R): R {
    // `step` reads the table's applied searchFn result through `active`.
    const prev = active
    active = table
    try {
      return next()
    } finally {
      active = prev
      checks.get(table)?.()
    }
  }

  function session(host: SearchHost): SearchSession {
    const { ctx, write, applied, input, claim } = host
    const table = ctx.table as unknown as object
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
    if (applied().trim() !== '') {
      const opts = ctx.table.getOptions()
      if (opts.initialData !== undefined && opts.data === undefined) seeded = applied()
      else requestsOf(table).defer('searchFn')
    }

    /** Ends the in-flight search without its result (its waiters: `'superseded'`). */
    const abort = () => {
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
      waiters.push(...claim(query))
      const a = { query, data, waiters, ctl: new AbortController() }
      attempt = a
      tried = { query, data }
      write(inp, applied(), 'searching')
      const c = {
        query: query.trim(),
        rows: data,
        columns: ctx.table.getOptions().columns ?? EMPTY,
      }
      requestsOf(table)
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

    /** After a pipeline run: new data or an outside query without a result → search again. */
    checks.set(table, () => {
      if (scheduled || dead) return
      const query = applied()
      if (query.trim() === '') return
      const data = ctx.table.getData()
      const r = results.get(table)
      if (r && r.query === query && r.data === data) return
      if (tried && tried.query === query && tried.data === data) return
      if (seeded !== undefined) {
        const initial = seeded === query && getTableInternals(table).initialRows() === data
        seeded = undefined
        if (initial) {
          results.set(table, { query, data, hits: { rows: data } })
          return
        }
      }
      if (requestsOf(table).defer('searchFn')) return
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
    })

    return {
      apply(query, inp) {
        const data = ctx.table.getData()
        const r = results.get(table)
        if (query.trim() === '' || (query === applied() && r?.query === query && r.data === data)) {
          abort()
          if (query.trim() === '') results.delete(table)
          return false
        }
        if (attempt && attempt.query === query && attempt.data === data) {
          attempt.waiters.push(...claim(query))
          write(inp, applied(), 'searching')
          return true
        }
        startSearch(query, inp)
        return true
      },
      busy: () => attempt !== undefined,
      abort,
      destroy() {
        dead = true
        abort()
      },
    }
  }

  return { step, run, session }
}
