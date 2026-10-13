import { createTable } from '@datakable/core'
import { columnFilters } from '@datakable/core/column-filters'

type Product = { sku: string; name: string; price: number; stock: number }
declare const products: Product[]

const table = createTable({ data: products, rowKey: 'sku', features: [columnFilters()] })

// `fn` gets the cell value (typed by the column), the filter's `value` and the row.
table.setColumnFilter('price', {
  type: 'custom',
  value: 0.2,
  fn: (price, maxDiscount, row) => row.stock > 0 && price * (1 - Number(maxDiscount)) < 100,
})
