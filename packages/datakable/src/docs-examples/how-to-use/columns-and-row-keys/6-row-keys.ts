import { createTable } from '@datakable/core'

type Order = { orderId: string; customer: { id: number }; line: number }
declare const orders: Order[]

// A path of the row type: the value must be a string or a number, unique across all rows.
const byId = createTable({ data: orders, rowKey: 'orderId' })

// A function, for a key made of several fields.
const byLine = createTable({
  data: orders,
  rowKey: (o) => `${o.orderId}-${o.line}`,
})

// Keys are computed over all rows, so they stay the same when you filter, sort or page.
for (const row of byLine.getRowModel().rows) console.log(row.key, row.index)
console.log(byId.getRowModel().rows[0]?.key)
