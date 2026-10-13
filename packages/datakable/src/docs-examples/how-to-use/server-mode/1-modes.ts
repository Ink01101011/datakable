import { columnFilters, createTable, pagination, search, sorting } from '@datakable/core'

type Order = { id: string; customer: string; total: number }
declare const firstPage: Order[]

// Server steps first, client steps after them: the server filters and searches, and the client
// sorts and pages the rows it returned. Listing the features in another order changes nothing:
// the pipeline always runs filter → search → sort → paginate.
const table = createTable({
  data: firstPage,
  rowKey: 'id',
  features: [
    columnFilters({ mode: 'server' }),
    search({ mode: 'server' }),
    sorting(), // 'client' is the default
    pagination({ pageSize: 25 }),
  ],
})

// The server-mode slices only hold state: these calls change it, and the app (or a fetcher)
// loads the matching rows.
table.setColumnFilter('total', { type: 'range', value: { min: 100 } })
void table.setSearch('acme')
