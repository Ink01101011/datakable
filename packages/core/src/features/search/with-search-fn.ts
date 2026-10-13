import { createSearchEngine } from './search-engine'
import { type AsyncSearchFn, SEARCH_ENGINE, type SearchFn } from './search-fn-brand'

const wrapped = new WeakMap<object, AsyncSearchFn<never>>()

/**
 * Opts a `searchFn` into the async search engine (§6.3): `search({ searchFn: withSearchFn(fn) })`.
 * The result calls `fn` and carries the engine (requests, abort, `status: 'searching'`,
 * stale-while-error, SSR deferral), which client search never bundles. Memoised per function, so
 * the identity follows `fn`'s.
 */
export function withSearchFn<T>(fn: SearchFn<T>): AsyncSearchFn<T> {
  let w = typeof fn === 'function' ? wrapped.get(fn) : undefined
  if (!w) {
    const call = ((ctx) => fn(ctx as never)) as AsyncSearchFn<never>
    Object.defineProperty(call, SEARCH_ENGINE, { value: createSearchEngine })
    w = call
    if (typeof fn === 'function') wrapped.set(fn, w)
  }
  return w as AsyncSearchFn<T>
}
