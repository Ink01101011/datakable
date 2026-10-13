'use client'
// app/users/users-table.tsx — a client component of the Next.js app router. `datakable` has no
// "use client" directive (its createTable also runs on the server), so the file that renders
// <DataTable /> or calls useDataTable is the client boundary.
import { DataTable } from 'datakable'

type User = { id: number; name: string }

export function UsersTable({ users }: { users: User[] }) {
  return <DataTable data={users} rowKey="id" />
}
