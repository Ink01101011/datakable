import { type ColumnDef, DataTable } from 'datakable/react'
import type { ReactNode } from 'react'

export type Order = {
  id: string
  customer: { name: string; email: string }
  total: number
  status: 'paid' | 'pending' | 'refunded'
  placedAt: Date
  tags: string[]
}

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const day = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' })

// Typed against Order: a key that is not a dot-path of Order, or a `format` that takes the wrong
// value type, is a compile error. Define columns outside the component (or memoise them).
const columns: ColumnDef<Order, ReactNode>[] = [
  { key: 'id', header: 'Order' },
  { key: 'customer.name', header: 'Customer', search: 2 }, // a nested value; search weight 2
  { key: 'customer.email', header: 'Email', search: 1, sensitive: true }, // never in diagnostics
  { key: 'total', header: 'Total', format: (total) => money.format(total) },
  {
    key: 'status',
    header: 'Status',
    // A cell renderer returns any ReactNode; `value` is typed 'paid' | 'pending' | 'refunded'.
    cell: ({ value }) => <mark data-order-status={value}>{value}</mark>,
  },
  { key: 'placedAt', header: 'Placed', format: (date) => day.format(date) },
  { key: 'tags', header: 'Tags', sortable: false }, // arrays of primitives are joined
  // A derived column: an `id` and an `accessor` instead of a `key`.
  { id: 'summary', header: 'Summary', accessor: (o) => `${o.tags.length} tags, ${o.status}` },
]

export function OrdersTable({ orders }: { orders: Order[] }) {
  return <DataTable data={orders} rowKey="id" columns={columns} caption="Orders" />
}
