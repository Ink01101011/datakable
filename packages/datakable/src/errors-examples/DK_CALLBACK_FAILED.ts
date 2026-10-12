import { createTable } from '@datakable/core'

type Order = { id: number; total: number | null }
const orders: Order[] = [
  { id: 1, total: 9.5 },
  { id: 2, total: null }, // not priced yet
  { id: 3, total: 12 },
]

const table = createTable({
  data: orders,
  columns: [
    { key: 'id' },
    { id: 'total', accessor: (order) => (order.total as number).toFixed(2) }, // throws on null
  ],
})
table.getRowModel().rows[1]?.getValue('total') // undefined; the other rows are fine
