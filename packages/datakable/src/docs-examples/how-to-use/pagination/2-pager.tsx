import { useDataTable } from 'datakable/react'

type User = { id: number; name: string }

export function UserPager({ users }: { users: User[] }) {
  const table = useDataTable({ data: users, rowKey: 'id' })
  const { pageIndex, pageSize } = table.state.pagination
  return (
    <nav aria-label="Pagination">
      <button type="button" disabled={!table.canPrevPage()} onClick={table.prevPage}>
        Previous
      </button>
      <span>
        Page {pageIndex + 1} of {Math.max(table.getPageCount(), 1)}
      </span>
      <button type="button" disabled={!table.canNextPage()} onClick={table.nextPage}>
        Next
      </button>
      <select value={pageSize} onChange={(e) => table.setPageSize(Number(e.target.value))}>
        {[10, 20, 50].map((size) => (
          <option key={size} value={size}>
            {size} per page
          </option>
        ))}
      </select>
    </nav>
  )
}
