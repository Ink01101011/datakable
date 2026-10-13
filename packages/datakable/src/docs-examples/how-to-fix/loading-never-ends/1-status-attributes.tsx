import { DataTable } from 'datakable'

type User = { id: number; name: string }

// <DataTable /> writes the row model's status on its root element:
// <div data-datakable data-status="fetching" data-initial-load="true">…
// Inspect it in the browser's devtools, or style it.
export function Users({ users }: { users: User[] }) {
  return <DataTable data={users} rowKey="id" caption="Users" />
}
