import type { RowModel } from '@datakable/core'

// What to show for a row model (§6.6). A change of `status` or `isInitialLoad` always produces a
// new row model and notifies subscribers: status is never silent.
export function view<T>(model: RowModel<T>) {
  const { status, isInitialLoad, rows } = model
  const busy = status === 'fetching' || status === 'searching' || status === 'validating'
  if (isInitialLoad && busy) return 'loading' // nothing to show yet
  if (isInitialLoad && status === 'error') return 'error' // the first request failed
  if (rows.length === 0 && status === 'idle') return 'empty' // loaded, zero rows
  // Otherwise show the rows: during 'pending' / 'searching' / 'fetching' / 'validating' they are
  // the previous results (add a refresh indicator); on 'error' they are the last good rows.
  return status === 'idle' ? 'rows' : `rows+${status}`
}
