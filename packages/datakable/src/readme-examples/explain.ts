import { createTable, defaultFeatures } from '@datakable/core'

type Product = { sku: string; name: string; price: number }
declare const products: Product[]

const table = createTable({ data: products, rowKey: 'sku', features: defaultFeatures })
table.setColumnFilter('price', { type: 'range', value: { min: 100 } })
await table.setSearch('chair')

// Where did my rows go? Rows per step, the page, timings (traced in development).
console.log(String(table.explain()))

// Why is this row not shown? Replays one row through every step.
const why = table.explainRow('SKU-042')
console.log(why.visible, why.removedBy, String(why))
