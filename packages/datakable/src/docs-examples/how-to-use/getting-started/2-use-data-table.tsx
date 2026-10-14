import { useDataTable } from 'datakable/react'

type User = { id: number; name: string; age: number; city: string }

// The same table, headless: you write the markup, the hook gives you the rows and the methods.
export function UserList({ users }: { users: User[] }) {
  const table = useDataTable({ data: users, rowKey: 'id' })
  return (
    <>
      <input
        value={table.state.search.input}
        onChange={(e) => void table.setSearch(e.target.value)}
        placeholder="Search"
      />
      <button type="button" onClick={() => table.toggleSort('age')}>
        Sort by age
      </button>
      <ul>
        {table.rowModel.rows.map((row) => (
          <li key={row.key}>
            {row.original.name}, {row.original.age}
          </li>
        ))}
      </ul>
      <button type="button" disabled={!table.canNextPage()} onClick={table.nextPage}>
        More
      </button>
    </>
  )
}
