import { createTable } from 'datakable'

type Product = { sku: string; name: string; price: number }
declare const products: Product[]

const table = createTable({ data: products, rowKey: 'sku' })
table.setColumnFilter('price', { type: 'range', value: { min: 100 } })
await table.setSearch('chair')

// Where did the rows go? Counts per step of the last run.
const e = table.explain()
for (const step of e.steps) {
  console.log(step.feature, step.mode, `${step.input} → ${step.output}`, step.cached, step.ms)
}
console.log(e.filteredCount, e.visible, e.page, e.diagnostics)

// Why is this row not shown? Replays one row through the schema and every step.
const why = table.explainRow('SKU-042')
if (why.found && !why.visible) console.log(why.removedBy, why.steps)

// The console report in development (JSON in production).
console.log(String(why))
