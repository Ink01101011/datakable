import { type PaginationState, useDataTable } from 'datakable'
import { useState } from 'react'

type User = { id: number; name: string }

export function Users({ users }: { users: User[] }) {
  // Own the pagination slice in React state; the table owns the rest.
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 })
  const table = useDataTable({
    data: users,
    rowKey: 'id',
    state: { pagination },
    onStateChange: (updater) => {
      const next = updater({ pagination })
      if (next.pagination) setPagination(next.pagination)
    },
  })
  return (
    <p>
      Page {pagination.pageIndex + 1} of {table.getPageCount()}
      <button type="button" onClick={table.nextPage} disabled={!table.canNextPage()}>
        Next
      </button>
    </p>
  )
}
