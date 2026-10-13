import { createTable } from 'datakable'

const users = [
  { id: 1, name: 'Ada', city: 'London', age: 36 },
  { id: 2, name: 'Grace', city: 'New York', age: 45 },
]

export const table = createTable({
  data: users,
  rowKey: 'id',
  // Once one column has a `search` weight, only the columns with a weight are searched.
  columns: [
    { key: 'name', search: 1 },
    { key: 'city', search: 0.5 }, // without a weight, 'London' would match nothing
    { key: 'age' },
  ],
})

await table.setSearch('London')
console.log(table.getRowModel().rows.map((row) => row.original.name))
