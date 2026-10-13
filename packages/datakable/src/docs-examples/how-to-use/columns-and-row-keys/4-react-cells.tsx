import { type ColumnDef, DataTable } from 'datakable'
import type { ReactNode } from 'react'

type User = { id: number; name: string; email: string; address: { city: string } }

// Hoisted: React compares `columns` by reference. `ReactNode` is the type `cell` returns.
const columns: ColumnDef<User, ReactNode>[] = [
  {
    key: 'name',
    header: 'Name',
    cell: ({ row, value }) => <a href={`/users/${row.id}`}>{value}</a>,
  },
  { key: 'email', header: 'Email', cell: ({ value }) => <a href={`mailto:${value}`}>{value}</a> },
  { key: 'address', header: 'City', cell: ({ value }) => <em>{value.city}</em> },
]

export function Users({ users }: { users: User[] }) {
  return <DataTable data={users} rowKey="id" columns={columns} />
}
