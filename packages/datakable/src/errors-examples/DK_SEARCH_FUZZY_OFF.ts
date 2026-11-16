import { createTable, search } from '@datakable/core'

const products = Array.from({ length: 2000 }, (_, i) => ({ id: i, name: `Chair ${i}` }))

// More rows than fuzzyMaxRows: this data is searched without typo matching.
const table = createTable({
  data: products,
  rowKey: 'id',
  features: [search({ fuzzyMaxRows: 1000 })],
})
await table.setSearch('chiar') // a typo of "chair": matches nothing on this data
