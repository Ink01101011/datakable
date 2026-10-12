import { keepDiagnostics } from '../diagnostics/catalog'
import { asyncRequests } from '../source/requests'
import { deferral, getTableInternals } from './internals'
import { ssrDiagnostics } from './ssr-codes'

keepDiagnostics(ssrDiagnostics)

/**
 * SSR seam for bindings (§7.2): runs `create` (a `createTable` call) so that the table it creates
 * starts no async work. The fetcher's first request and a `searchFn` for an initial query wait for
 * `startTable(table)`; meanwhile the row model has `status: 'pending'`. Nothing is started, so a
 * server render leaves no request, timer or microtask chain behind. On the server (no
 * `document`), each deferred source reports `DK_SSR_ASYNC_DEFERRED` (info).
 *
 * `@datakable/react`'s `useDataTable` creates its table this way and starts it after the commit;
 * effects never run on the server.
 */
export function createDeferred<R extends object>(create: () => R): R {
  deferral.depth++
  let table: R
  try {
    table = create()
  } finally {
    deferral.depth--
  }
  if (typeof document === 'undefined') {
    const internals = getTableInternals(table)
    for (const source of internals.peek(asyncRequests)?.deferred() ?? []) {
      internals.emit('DK_SSR_ASYNC_DEFERRED', { source }, { phase: 'ssr' })
    }
  }
  return table
}

/**
 * Starts the async work a `createDeferred` table deferred (§7.2): the fetcher's first request
 * (unless `initialData` answered it) and the `searchFn` for the applied query. Idempotent; a no-op
 * for a table that was not deferred or is destroyed.
 */
export function startTable(table: object): void {
  getTableInternals(table).start()
}
