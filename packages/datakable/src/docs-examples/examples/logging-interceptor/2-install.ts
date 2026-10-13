import { createTable } from 'datakable'
import { reportSlowRuns, type Track, trackActions } from './1-analytics' // './analytics' in your app

type User = { id: number; name: string; age: number }

const users: User[] = [
  { id: 1, name: 'Mali', age: 31 },
  { id: 2, name: 'Anan', age: 25 },
]

export const events: [string, Record<string, string | number>][] = []
const track: Track = (event, props) => events.push([event, props])

// Interceptors wrap the table's operations; with useDataTable / <DataTable />, pass the same
// array as `interceptors` (define it outside the component).
const table = createTable({
  data: users,
  rowKey: 'id',
  interceptors: [trackActions(track), reportSlowRuns(track)],
})

table.toggleSort('age')
await table.setSearch('mal')
console.log(events) // [['table_action', { action: 'toggleSort' }], ['table_action', { action: 'setSearch' }]]
