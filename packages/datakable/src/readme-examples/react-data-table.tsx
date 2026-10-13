import { type ColumnDef, pagination, search, sorting } from '@datakable/core'
import { DataTable } from '@datakable/react'
import type { ReactNode } from 'react'

type User = { id: number; name: string; age: number }

const columns: ColumnDef<User, ReactNode>[] = [
  { key: 'name', header: 'Name' },
  { key: 'age', header: 'Age', sortable: false },
]
// @datakable/react's DataTable renders what the installed features provide (none by default).
const features = [search(), sorting(), pagination({ pageSize: 20 })]

export function Users({ users }: { users: User[] }) {
  return <DataTable data={users} rowKey="id" columns={columns} features={features} />
}
