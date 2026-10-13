import { createTable } from '@datakable/core'
import { search } from '@datakable/core/search'

type User = { id: number; name: string; email: string; city: string; age: number }
declare const users: User[]

const table = createTable({
  data: users,
  rowKey: 'id',
  features: [search()],
  // Only columns with a `search` weight are searched once any column declares one.
  columns: [
    { key: 'name', search: 2 }, // a match here counts twice as much
    { key: 'email', search: 1 },
    { key: 'city', search: 0.5 },
    { key: 'age' }, // no weight: not searched
  ],
})

// Resolves when the query is applied, replaced by a newer one, or failed. Never rejects.
const { status } = await table.setSearch('mali')
console.log(status) // 'applied'

const { input, query } = table.getState().search
console.log(input, query) // 'mali' 'mali': the default typing strategy applies every keystroke
console.log(table.getRowModel().rows.map((row) => row.original.name)) // best match first

table.clearSearch() // empties input and query: every row again
