import { columnFilters, createTable } from '@datakable/core'

// `age` arrives as strings from a CSV / form API.
const users = [
  { id: 1, name: 'Ada', age: '36' },
  { id: 2, name: 'Grace', age: '45' },
]

const table = createTable({ data: users, features: [columnFilters()] })
// @ts-expect-error a range filter needs number cells; TypeScript sees the string column too
table.setColumnFilter('age', { type: 'range', value: { min: 40 } })
table.getRowModel()
