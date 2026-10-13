import { createTable } from '@datakable/core'
import { sorting } from '@datakable/core/sorting'
import { threshold } from './1-threshold-feature'

type Product = { sku: string; name: string; price: number }
declare const products: Product[]

const table = createTable({
  data: products,
  rowKey: 'sku',
  features: [threshold({ min: 10 }), sorting()],
})

table.setThreshold('price', 100) // typed against Product
table.toggleSort('price')
console.log(table.getState().threshold) // { column: 'price', min: 100 }

// @ts-expect-error 'cost' is not a path of Product
table.setThreshold('cost', 100)
