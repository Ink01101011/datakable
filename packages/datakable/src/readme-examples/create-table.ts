import { createTable } from 'datakable'

type User = { id: number; name: string; age: number; city: string }

const users: User[] = [
  { id: 1, name: 'Mali', age: 31, city: 'Bangkok' },
  { id: 2, name: 'Anan', age: 25, city: 'Chiang Mai' },
  { id: 3, name: 'Ploy', age: 40, city: 'Bangkok' },
]

// No React needed: the same table, headless. `User` is inferred from `data`.
const table = createTable({ data: users, rowKey: 'id' })

table.toggleSort('age') // asc → desc → none; Shift+click style: toggleSort('age', { multi: true })
table.setColumnFilter('city', { type: 'equals', value: 'Bangkok' })
await table.setSearch('mal') // resolves { status: 'applied' | 'superseded' | 'error' }, never rejects
table.setPageSize(20)

const { rows, filteredCount, totalCount, status } = table.getRowModel()
console.log(
  rows.map((r) => r.original.name),
  filteredCount,
  totalCount,
  status,
)

const unsubscribe = table.subscribe((state) => console.log(state.sorting.by))
unsubscribe()
table.destroy()
