import { createTable } from 'datakable'

const products = [
  { sku: 'SKU-001', name: 'Desk chair', price: 120 },
  { sku: 'SKU-002', name: 'Desk lamp', price: 40 },
  { sku: 'SKU-003', name: 'Bookshelf', price: 150 },
]

// A filter restored from the URL that no product matches any more.
export const table = createTable({
  data: products,
  rowKey: 'sku',
  initialState: { columnFilters: { price: { type: 'range', value: { min: 500 } } } },
})

// Where did the rows go? Rows per step, from the data to the page.
console.log(String(table.explain()))
// Why is this row not shown? The step that removed it, and a fix.
console.log(String(table.explainRow('SKU-001')))
