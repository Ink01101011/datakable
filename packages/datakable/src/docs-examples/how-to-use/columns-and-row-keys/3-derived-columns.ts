import { createTable } from '@datakable/core'
import { search } from '@datakable/core/search'
import { sorting } from '@datakable/core/sorting'

type User = { id: number; first: string; last: string; born: number }
declare const users: User[]

const table = createTable({
  data: users,
  rowKey: 'id',
  features: [search(), sorting()],
  columns: [
    // A derived column: `u` is typed as User. Shown and searched like any other column.
    { id: 'fullName', accessor: (u) => `${u.first} ${u.last}`, header: 'Name', search: 1 },
    // To sort by a computed value through the typed API, give a key column a `sortBy`.
    { key: 'last', header: 'Family name', sortBy: (u) => `${u.last} ${u.first}` },
    { key: 'born', header: 'Age', format: (year) => String(2026 - year) },
  ],
})

table.toggleSort('last') // sorts by "last first"
console.log(table.getRowModel().rows[0]?.getValue('fullName'))
