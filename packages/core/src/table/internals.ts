import type { AsyncStatus } from '../source/async-control'

/**
 * Internal seam for core modules that run async work through a table (search T19, fetcher T21).
 * Not exported from the package: `createTable` registers each table here.
 */
export interface TableInternals {
  /**
   * Runs one `async:request` through the table's interceptor chain (errorBoundary → asyncControl
   * → …), with `previous` as FALLBACK. Resolves with the outcome; apply `value` only when
   * `status === 'applied'`. Never rejects, except under `strict` (a `DatakableError`).
   */
  request(
    source: 'fetcher' | 'searchFn',
    core: (signal: AbortSignal) => Promise<unknown>,
    opts?: { previous?: unknown; params?: unknown; signal?: AbortSignal },
  ): Promise<{ value: unknown; status: AsyncStatus }>
}

const registry = new WeakMap<object, TableInternals>()

export function setTableInternals(table: object, internals: TableInternals): void {
  registry.set(table, internals)
}

export function getTableInternals(table: object): TableInternals {
  const i = registry.get(table)
  if (!i) throw new TypeError('getTableInternals: not a table made by createTable()')
  return i
}
