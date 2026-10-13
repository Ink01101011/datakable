import { type PaginationState, useDataTable } from 'datakable'
import { useState } from 'react'

type User = { id: number; name: string }

export function Users({ users }: { users: User[] }) {
  // Own the pagination slice (e.g. to keep it in the URL); the table owns the other slices.
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 })
  const table = useDataTable({
    data: users,
    rowKey: 'id',
    state: { pagination },
    // Receives an updater over the controlled slices that changed.
    onStateChange: (updater) => {
      const next = updater({ pagination })
      if (next.pagination) setPagination(next.pagination)
    },
  })
  return (
    <button type="button" disabled={!table.canNextPage()} onClick={table.nextPage}>
      Page {pagination.pageIndex + 2}
    </button>
  )
}
