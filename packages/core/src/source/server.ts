import { errorName } from '../intercept/classify'
import type { ExtensionFactory, TableExtension, TableHost } from '../table/internals'
import type { AsyncStatus } from './async-control'
import {
  callFetcher,
  checkFetcher,
  checkResponse,
  type Fetcher,
  FetchFailure,
  type FetchKey,
  type FetchOutcome,
  fetchParams,
  isServer,
  sameParams,
} from './fetcher'
import { asyncRequests } from './requests'

/** The server source of one table (§7.1): the fetcher's requests, its status and row count. */
export interface ServerSource extends TableExtension {
  /**
   * Starts a fetcher request when the server-mode state differs from the last request's (or
   * `force`: `refetch()`). Resolves with the outcome; never rejects.
   */
  sync(force?: boolean): Promise<FetchOutcome> | undefined
  /** `rowCount` of the last applied fetcher result (§6.5). */
  rowCount(): number | undefined
  /** `setOptions({ fetcher })`, before anything changes: `DK_FETCHER_WITHOUT_SERVER_MODE`. */
  check(fetcher: unknown): void
  /** A new fetcher reference: it runs at once, even with the same params (flush → sync). */
  reset(): void
}

/**
 * The server source as a table extension (changed 2026-10-13 for §9.3): it comes with
 * `withFetcher(fetcher)`, so a table without a fetcher never bundles it.
 */
export const serverSource: ExtensionFactory<ServerSource> = (host: TableHost) => {
  const requests = host.use(asyncRequests)
  const serverFeatures = host.features.filter(isServer)
  /** The latest fetcher request failed or returned a bad response: 'error' until one applies. */
  let failed = false
  /** `rowCount` of the last applied fetcher result (§6.5). */
  let rowCount: number | undefined
  /** Params of the last fetcher request; a flush with other params starts a new one (§7.1). */
  let fetched: FetchKey | undefined

  function fail() {
    if (failed) return
    failed = true
    host.touch()
  }

  /**
   * Applies a fetcher outcome; only the latest request reaches `'applied'` (asyncControl). `true`
   * when its rows were applied.
   */
  function apply(value: unknown, outcome: AsyncStatus): boolean {
    if (outcome === 'superseded') {
      host.emit('DK_FETCH_ABORTED', {})
      return false
    }
    if (outcome === 'aborted') return false
    // 'error' / 'timeout': already reported by the errorBoundary / asyncControl.
    if (outcome !== 'applied') {
      fail()
      return false
    }
    if (value instanceof FetchFailure) {
      fail()
      const name = errorName(value.error)
      host.emit(
        'DK_FETCH_FAILED',
        { ...(name === undefined ? {} : { errorName: name }), hadRows: host.loaded() },
        { cause: value.error },
      )
      return false
    }
    const bad = checkResponse(
      value,
      serverFeatures.some((f) => f.stage === 'paginate'),
    )
    if (bad) {
      fail()
      host.emit('DK_FETCH_BAD_RESPONSE', bad)
      return false
    }
    if (failed) {
      failed = false
      host.touch()
    }
    const result = value as { rows: readonly unknown[]; rowCount?: number }
    rowCount = result.rowCount ?? result.rows.length
    host.ingest(result.rows)
    return true
  }

  function sync(force = false): Promise<FetchOutcome> | undefined {
    const fetcher = host.options().fetcher as Fetcher<unknown> | undefined
    if (typeof fetcher !== 'function' || host.destroyed()) return
    const params = fetchParams(serverFeatures, host.state())
    if (!force && fetched && sameParams(fetched, params)) return
    // Deferred (SSR, §7.2): no request until startTable; then the latest params are fetched.
    if (requests.defer('fetcher')) return
    fetched = params
    let result: FetchOutcome['status'] | undefined
    const done = (): FetchOutcome => ({
      status: result ?? (host.destroyed() ? 'superseded' : 'error'),
    })
    return requests
      .request('fetcher', (signal) => callFetcher(fetcher, params, signal), {
        params,
        onSettle: (value, outcome) => {
          result = outcome === 'superseded' || outcome === 'aborted' ? 'superseded' : 'error'
          if (apply(value, outcome)) result = 'applied'
        },
        // strict: the DatakableError was reported by the hub; the status is 'error' (apply).
      })
      .then(done, done)
  }

  const options = host.options()
  checkFetcher(host.features, options.fetcher, host.name)
  // initialData answers the initial server state (§7.2): no first request, its total as rowCount.
  if (options.initialData !== undefined && options.data === undefined) {
    fetched = fetchParams(serverFeatures, host.state())
    rowCount = options.rowCount ?? options.initialData.length
  }

  return {
    sync,
    rowCount: () => rowCount,
    status: () => (failed ? 'error' : undefined),
    check: (fetcher) => checkFetcher(host.features, fetcher, host.name, 'setOptions'),
    reset() {
      fetched = undefined
    },
  }
}
