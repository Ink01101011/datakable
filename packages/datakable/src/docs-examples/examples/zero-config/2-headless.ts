import { createTable } from 'datakable'

type User = { id: number; name: string; age: number; city: string }

const users: User[] = [
  { id: 1, name: 'Mali Srisuk', age: 31, city: 'Bangkok' },
  { id: 2, name: 'Anan Wong', age: 25, city: 'Chiang Mai' },
  { id: 3, name: 'Ploy Chai', age: 40, city: 'Bangkok' },
  { id: 4, name: 'Ada Lovelace', age: 36, city: 'London' },
]

// The same table without React: the same preset, the same row model.
export const table = createTable({ data: users, rowKey: 'id' })

table.setColumnFilter('city', { type: 'equals', value: 'Bangkok' })
table.toggleSort('age') // ascending

const { rows, filteredCount, totalCount } = table.getRowModel()
console.log(rows.map((row) => row.original.name)) // ['Mali Srisuk', 'Ploy Chai']
console.log(`${filteredCount} of ${totalCount}`) // '2 of 4'
