import { useDataTable } from 'datakable'

type User = { id: number; name: string; age: number; city: string }

export function Users({ users }: { users: User[] }) {
  // Zero-config: columns come from the data; sorting, filters, search and pagination are on.
  const table = useDataTable({ data: users, rowKey: 'id' })
  const { rows, filteredCount, status, isInitialLoad } = table.rowModel

  if (status === 'error' && isInitialLoad) return <p>Could not load users.</p>
  return (
    <section data-status={status}>
      <input
        value={table.state.search.input}
        onChange={(e) => void table.setSearch(e.target.value)}
        placeholder="Search"
      />
      <table>
        <thead>
          <tr>
            <th aria-sort={table.getSortDirection('name') === 'desc' ? 'descending' : 'none'}>
              <button type="button" onClick={() => table.toggleSort('name')}>
                Name
              </button>
            </th>
            <th>Age</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.original.name}</td>
              <td>{row.original.age}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>{filteredCount} users</p>
      <button type="button" disabled={!table.canPrevPage()} onClick={table.prevPage}>
        Previous
      </button>
      <button type="button" disabled={!table.canNextPage()} onClick={table.nextPage}>
        Next
      </button>
    </section>
  )
}
