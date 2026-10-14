import { type ColumnDef, useDataTable } from 'datakable/react'
import type { ReactNode } from 'react'

type User = { id: number; name: string; email: string; age: number }

// Compared by reference: define columns outside the component (or memoise them).
const columns: ColumnDef<User, ReactNode>[] = [
  { key: 'name', header: 'Name', cell: ({ value }) => <strong>{value}</strong> },
  { key: 'email', header: 'Email' },
  { key: 'age', header: 'Age' },
]

export function Users({ users }: { users: User[] }) {
  // `datakable/react`: the default preset (filters, validity, search, sorting, pagination).
  const table = useDataTable({ data: users, rowKey: 'id', columns })
  const { rows, filteredCount } = table.rowModel

  return (
    <>
      <input
        value={table.state.search.input}
        onChange={(e) => void table.setSearch(e.target.value)}
        aria-label="Search users"
      />
      <ul>
        {rows.map((row) => (
          <li key={row.key}>
            {row.original.name} ({row.original.age})
          </li>
        ))}
      </ul>
      <p>
        {filteredCount} users · page {table.state.pagination.pageIndex + 1} of{' '}
        {table.getPageCount()}
      </p>
    </>
  )
}
