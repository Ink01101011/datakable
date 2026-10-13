import { createTable, tracer } from 'datakable'

type Product = { sku: string; price: number }
declare const products: Product[]

// Development installs the tracer by itself. In production it is off; opt in to get step timings
// in explain() and DK_PERF_HINT for steps over 50 ms.
const table = createTable({ data: products, rowKey: 'sku', interceptors: [tracer()] })
table.toggleSort('price')
console.log(table.explain().traced, table.explain().ms)
