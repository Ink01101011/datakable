import { createTable } from '@datakable/core'
import { search } from '@datakable/core/search'

type Order = { id: number; customer: string; city: string }
declare const orders: Order[]

const table = createTable({
  data: orders,
  rowKey: 'id',
  // Up to 50,000 rows: typos match (fuzzyMaxDistance 3). Above: exact, prefix, substring only.
  features: [search({ fuzzyMaxRows: 50_000 })],
})

await table.setSearch('somchai') // finds "Somchai" at any size
await table.setSearch('somchia') // a typo: found up to 50,000 rows, not above
