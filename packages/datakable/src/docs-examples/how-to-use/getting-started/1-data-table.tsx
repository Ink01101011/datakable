import { DataTable } from 'datakable'

type User = { id: number; name: string; age: number; city: string }

// The whole table: columns come from the data; sort headers, a search input, pagination and the
// Loading / Empty / Error states are built in. Unstyled: add the optional stylesheet
// (datakable/styles.css) for a default look.
export function Users({ users }: { users: User[] }) {
  return <DataTable data={users} rowKey="id" caption="Users" />
}
