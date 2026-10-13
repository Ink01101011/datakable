import { createTable } from 'datakable'

type User = { id: number; name: string; age: number }
declare const users: User[]

// No `features`: `datakable` installs the default preset, fresh instances per table.
const table = createTable({ data: users, rowKey: 'id' })

table.setColumnFilter('age', { type: 'range', value: { min: 18 } }) // columnFilters()
table.setValidity('all') // validity()
await table.setSearch('ada') // search()
table.toggleSort('name') // sorting()
table.nextPage() // pagination()
