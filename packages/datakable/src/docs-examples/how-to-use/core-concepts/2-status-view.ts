import { createTable, type RowModel } from 'datakable'

type User = { id: number; name: string }
declare const users: User[]
declare function render(html: string): void

/** What to show for a row model: every status / isInitialLoad combination. */
function view(model: RowModel<User>): string {
  const { status, isInitialLoad, rows } = model
  const busy = status !== 'idle' && status !== 'error'
  if (isInitialLoad && busy) return 'Loading…' // nothing to show yet
  if (isInitialLoad && status === 'error') return 'Could not load.' // the first load failed
  if (rows.length === 0 && status === 'idle') return 'No users.' // loaded, zero rows
  const list = rows.map((row) => row.original.name).join(', ')
  // Rows are on screen; when busy or failed they are the previous (last good) ones.
  return status === 'idle' ? list : `${list} (${status === 'error' ? 'stale' : 'updating…'})`
}

const table = createTable({ data: users, rowKey: 'id' })
render(view(table.getRowModel()))
// Every change of status or isInitialLoad notifies: the view never misses one.
table.subscribe(() => render(view(table.getRowModel())))
