import { useDataTable } from 'datakable/react'
import { useEffect } from 'react'

type Order = { id: number; customer: string; status: string }

export function Orders({ orders, status }: { orders: Order[]; status: string }) {
  const table = useDataTable({
    data: orders,
    rowKey: 'id',
    // The first value, at creation.
    initialState: { columnFilters: { status: { type: 'equals', value: status } } },
  })
  // Table methods keep their identity across renders; the returned object does not.
  const { setColumnFilter } = table
  // Later changes: after the render, not while rendering — a table update during render
  // re-renders the component, which updates the table again, and so on.
  useEffect(() => {
    setColumnFilter('status', { type: 'equals', value: status })
  }, [setColumnFilter, status])
  return <p>{table.rowModel.filteredCount} orders</p>
}
