import { createTable } from '@datakable/core'
import { columnFilters } from '@datakable/core/column-filters'
import { pagination } from '@datakable/core/pagination'
import { search } from '@datakable/core/search'
import { sorting } from '@datakable/core/sorting'

type User = { id: number; name: string; city: string }
declare const users: User[]

// Listed in any order, run by stage: filter → search → sort → paginate.
const table = createTable({
  data: users,
  features: [pagination(), sorting(), search(), columnFilters()],
})

table.setColumnFilter('city', { type: 'equals', value: 'Bangkok' })
await table.setSearch('mal') // searches the filtered rows only
table.toggleSort('name') // sorts the search results
console.log(table.getRowModel().rows) // the first page of the sorted results
