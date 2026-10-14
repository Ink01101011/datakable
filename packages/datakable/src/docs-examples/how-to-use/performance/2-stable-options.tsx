import { type ColumnDef, DataTable } from 'datakable/react'
import type { ReactNode } from 'react'
import { useMemo } from 'react'

type Order = { id: string; total: number; status: 'open' | 'paid' }

// Columns compared by reference: hoisted, so every render passes the same array.
const columns: ColumnDef<Order, ReactNode>[] = [
  { key: 'id', header: 'Order' },
  { key: 'total', header: 'Total', format: (v) => v.toFixed(2) },
  { key: 'status', header: 'Status' },
]

export function Orders({ orders, onlyOpen }: { orders: Order[]; onlyOpen: boolean }) {
  // Derived data memoised: a new array only when its inputs change, so the table re-ingests
  // (and rebuilds its caches) only then.
  const data = useMemo(
    () => (onlyOpen ? orders.filter((o) => o.status === 'open') : orders),
    [orders, onlyOpen],
  )
  return <DataTable data={data} rowKey="id" columns={columns} />
}
