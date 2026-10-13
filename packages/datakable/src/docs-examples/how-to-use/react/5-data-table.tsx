import { DataTable } from 'datakable'

type User = { id: number; name: string; age: number }

// Columns derived from the data, the default preset, a caption. Unstyled until you style the
// data-* hooks or add the optional stylesheet (datakable/styles.css) once in your app entry.
export function Users({ users }: { users: User[] }) {
  return <DataTable data={users} rowKey="id" caption="Users" />
}
