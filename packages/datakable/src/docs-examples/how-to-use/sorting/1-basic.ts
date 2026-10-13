import { createTable } from '@datakable/core'
import { sorting } from '@datakable/core/sorting'

type User = { id: number; name: string; age: number; city: string }
declare const users: User[]

const table = createTable({ data: users, rowKey: 'id', features: [sorting()] })

table.toggleSort('age') // by: [{ id: 'age', desc: false }]
table.toggleSort('age') // by: [{ id: 'age', desc: true }]
table.toggleSort('age') // by: []: back to the input order

table.toggleSort('city')
table.toggleSort('name', { multi: true }) // city, then name: [{ city asc }, { name asc }]
console.log(table.getSortDirection('name')) // 'asc'; false for a column not in the sort

table.setSorting([{ id: 'age', desc: true }]) // replace the whole sort
table.clearSorting()
console.log(table.getState().sorting.by) // []
