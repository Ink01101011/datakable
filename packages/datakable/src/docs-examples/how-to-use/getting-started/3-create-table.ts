import { createTable } from 'datakable'

type User = { id: number; name: string; age: number; city: string }

const users: User[] = [
  { id: 1, name: 'Mali', age: 31, city: 'Bangkok' },
  { id: 2, name: 'Anan', age: 25, city: 'Chiang Mai' },
  { id: 3, name: 'Ploy', age: 40, city: 'Bangkok' },
]

// No React: the same table and the same default preset, in Node, a worker or a test.
const table = createTable({ data: users, rowKey: 'id' })

table.setColumnFilter('city', { type: 'equals', value: 'Bangkok' })
table.toggleSort('age')

const { rows, filteredCount } = table.getRowModel()
console.log(
  rows.map((row) => row.original.name), // ['Mali', 'Ploy']
  filteredCount, // 2
)
table.destroy()
