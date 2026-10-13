import type { ExtensionFactory } from '../table/internals'
import type { Fetcher } from './fetcher'
import type { ServerSource } from './server'

/** Key of the server source a {@link ServerFetcher} carries (§7.1). Registered: copies agree. */
export const SERVER_SOURCE: unique symbol = Symbol.for('datakable.serverSource') as never

/**
 * A fetcher opted into the server source with `withFetcher()` from `@datakable/core/server`
 * (§7.1, changed 2026-10-13 for §9.3): `options.fetcher` takes only these, so a table without a
 * fetcher never bundles the server source or the request machinery.
 */
export type ServerFetcher<T> = Fetcher<T> & {
  readonly [SERVER_SOURCE]: ExtensionFactory<ServerSource>
}
