'use client'

// app/users/users-table.tsx — a client component of the Next.js app router. Only the modules of
// <DataTable /> and useDataTable are "use client" (createTable also runs on the server); call the
// hook, or pass functions such as cell components, features or a fetcher, from a file like this.
import { DataTable } from 'datakable'

type User = { id: number; name: string }

export function UsersTable({ users }: { users: User[] }) {
  return <DataTable data={users} rowKey="id" />
}
