import { createTable, search } from '@datakable/core'

const products = [
  { sku: 'A-1', price: 9.5 },
  { sku: 'B-2', price: 12 },
]

const table = createTable({
  data: products,
  // A format that returns a number (cents) instead of a string.
  columns: [{ key: 'sku' }, { key: 'price', format: ((v: number) => v * 100) as never }],
  features: [search()],
})
await table.setSearch('950')
