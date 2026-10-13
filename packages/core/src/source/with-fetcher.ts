import type { Fetcher } from './fetcher'
import { serverSource } from './server'
import { SERVER_SOURCE, type ServerFetcher } from './server-brand'

const wrapped = new WeakMap<object, ServerFetcher<never>>()

/**
 * Opts a fetcher into the server source (§7.1): `createTable({ fetcher: withFetcher(fetchUsers),
 * features: [pagination({ mode: 'server' })] })`. The result calls `fetcher` and carries the server
 * source (requests, `status: 'fetching'`, `refetch()`), which a table without a fetcher never
 * bundles. Memoised per function, so the identity follows `fetcher`'s: a stable fetcher stays
 * stable (`setOptions({ fetcher })` with a new one runs it at once, §7.1).
 */
export function withFetcher<T>(fetcher: Fetcher<T>): ServerFetcher<T> {
  let w = typeof fetcher === 'function' ? wrapped.get(fetcher) : undefined
  if (!w) {
    const call = ((params) => fetcher(params)) as ServerFetcher<never>
    Object.defineProperty(call, SERVER_SOURCE, { value: serverSource })
    w = call
    if (typeof fetcher === 'function') wrapped.set(fetcher, w)
  }
  return w as ServerFetcher<T>
}
