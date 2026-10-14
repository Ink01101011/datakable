import { DataTable } from 'datakable/react'

type User = { id: number; name: string; age: number }

// The wrapper class scopes the theme to this table. The stylesheet and the theme are plain CSS,
// below.
export function UsersTable({ users }: { users: User[] }) {
  return (
    <div className="users-table">
      <DataTable data={users} rowKey="id" caption="Users" />
    </div>
  )
}
