'use client'

// app/users/users-table.tsx — a client component of the Next.js app router. `datakable` has no
// "use client" directive (so createTable also runs on the server); the hook and the component
// must be rendered from a client component like this one.
import { DataTable } from 'datakable'

type User = { id: number; name: string }

export function UsersTable({ users }: { users: User[] }) {
  return <DataTable data={users} rowKey="id" />
}
