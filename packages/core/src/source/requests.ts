import { createContext } from '../intercept/context'
import type { Interceptor } from '../intercept/define'
import { FALLBACK } from '../intercept/fallbacks'
import type { OpName } from '../intercept/operations'
import { getTableInternals, type TableHost } from '../table/internals'
import { ASYNC_STATUS, type AsyncStatus, asyncControl } from './async-control'

/** An async source of a table: `status` 'fetching' / 'searching' while one is in flight (§6.6). */
export type AsyncSource = 'fetcher' | 'searchFn'

export interface RequestOptions {
  previous?: unknown
  params?: unknown
  signal?: AbortSignal
  /**
   * Applies the outcome before the in-flight status is cleared, in one batch: the status change
   * and the applied result are one notification. Called on every outcome.
   */
  onSettle?: (value: unknown, status: AsyncStatus) => void
}

/** A table's async request machinery (§3.4 `async:request`, §6.6, §7.2). */
export interface Requests {
  /**
   * Runs one `async:request` through the table's interceptor chain (errorBoundary → asyncControl
   * → …), with `previous` as FALLBACK. Resolves with the outcome; apply `value` only when
   * `status === 'applied'`. Never rejects, except under `strict` (a `DatakableError`).
   */
  request(
    source: AsyncSource,
    core: (signal: AbortSignal) => Promise<unknown>,
    opts?: RequestOptions,
  ): Promise<{ value: unknown; status: AsyncStatus }>
  /**
   * SSR (§7.2, `createDeferred`): `true` while the table waits for `startTable`; `source` is then
   * recorded as deferred work (`status: 'pending'`) and must not start. `false` once started.
   */
  defer(source: AsyncSource): boolean
  /** The sources deferred since creation (`DK_SSR_ASYNC_DEFERRED`). */
  deferred(): readonly AsyncSource[]
  status(): 'fetching' | 'searching' | 'pending' | undefined
  start(): boolean
}

/**
 * The request machinery as a table extension (changed 2026-10-13 for §9.3): created on the first
 * async source (`searchFn`, `withFetcher`), so a table without one bundles neither it nor
 * asyncControl. One asyncControl per table, installed first in the chain (`options.timeout` is
 * read once, here).
 */
export function asyncRequests(host: TableHost): Requests {
  const timeout = host.options().timeout
  host.intercept(asyncControl(timeout === undefined ? {} : { timeout }) as Interceptor<OpName>)
  /** In-flight `async:request`s per source: `status` 'fetching' / 'searching' (§6.6). */
  const inflight = { fetcher: 0, searchFn: 0 }
  /** `createDeferred` (§7.2): the async work waiting for `startTable`; `undefined` once started. */
  let waiting: Set<AsyncSource> | undefined = host.deferring() ? new Set() : undefined
  /** Every source deferred since creation (`DK_SSR_ASYNC_DEFERRED`). */
  const deferredSources: AsyncSource[] = []

  /** Moves the in-flight count of `source`; a status change is never silent (§6.6). */
  function track(source: AsyncSource, delta: 1 | -1) {
    const before = host.status()
    inflight[source] += delta
    if (host.status() !== before) host.touch()
  }

  /** Ends a request in one batch: its result applied and the status cleared, one notification. */
  function settle(source: AsyncSource, apply: () => void) {
    if (host.destroyed()) {
      inflight[source]--
      return
    }
    host.batch('fetch', () => {
      const before = host.status()
      try {
        inflight[source]--
        apply()
      } finally {
        if (host.status() !== before) host.touch()
      }
    })
  }

  async function request(
    source: AsyncSource,
    core: (signal: AbortSignal) => Promise<unknown>,
    opts: RequestOptions = {},
  ): Promise<{ value: unknown; status: AsyncStatus }> {
    if (host.destroyed()) return { value: opts.previous, status: 'aborted' }
    const ctx = createContext(
      'async:request',
      opts.params === undefined ? { source } : { source, params: opts.params },
      source,
      { ...host.base(), trigger: 'fetch' },
      opts.signal,
    )
    ctx.meta.set(FALLBACK, opts.previous)
    // 'fetching' / 'searching' starts now: a new row model and a notification (unless batched).
    track(source, 1)
    host.notify()
    let value: unknown = opts.previous
    let outcome: AsyncStatus = 'error'
    try {
      value = await host.runtime.run('async:request', ctx, (c) => core(c.signal as AbortSignal))
      outcome = (ctx.meta.get(ASYNC_STATUS) as AsyncStatus | undefined) ?? 'error'
      return { value, status: outcome }
    } finally {
      // Also when it rejected (strict): the status never stays in flight.
      settle(source, () => opts.onSettle?.(value, outcome))
    }
  }

  return {
    request,
    defer(source) {
      if (waiting === undefined) return false
      if (!waiting.has(source)) {
        waiting.add(source)
        if (!deferredSources.includes(source)) deferredSources.push(source)
        // 'pending' is never silent (§6.6).
        host.touch()
      }
      return true
    },
    deferred: () => deferredSources,
    status: () =>
      inflight.fetcher > 0
        ? 'fetching'
        : inflight.searchFn > 0
          ? 'searching'
          : waiting !== undefined && waiting.size > 0
            ? 'pending'
            : undefined,
    start() {
      const had = waiting !== undefined && waiting.size > 0
      waiting = undefined
      return had
    },
  }
}

/** The request machinery of `table` (created on first use). */
export const requestsOf = (table: object): Requests => getTableInternals(table).use(asyncRequests)
