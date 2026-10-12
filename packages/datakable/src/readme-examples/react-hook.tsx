import { type ColumnDef, pagination, sorting } from '@datakable/core'
import { useDataTable } from '@datakable/react'
import type { ReactNode } from 'react'

type User = { id: number; name: string; age: number }

// Columns are compared by reference: define them outside the component, or memoise them
// (DK_UNSTABLE_COLUMNS warns in development when a new same-shape array arrives every render).
const columns: ColumnDef<User, ReactNode>[] = [
  { key: 'name', header: 'Name', cell: ({ value }) => <strong>{value}</strong> },
  { key: 'age', header: 'Age' },
]

export function Users({ users }: { users: User[] }) {
  // @datakable/react installs no features by default; `datakable` adds the preset.
  const table = useDataTable({
    data: users,
    rowKey: 'id',
    columns,
    features: [sorting(), pagination({ pageSize: 20 })],
  })
  return (
    <ul aria-busy={table.rowModel.status !== 'idle'}>
      {table.rowModel.rows.map((row) => (
        <li key={row.key}>{row.original.name}</li>
      ))}
    </ul>
  )
}
