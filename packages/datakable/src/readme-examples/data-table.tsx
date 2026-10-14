import { DataTable, type DataTableComponents, useDataTable } from 'datakable/react'

type User = { id: number; name: string; age: number }

// Zero-config: columns come from the data; sort headers (with aria-sort), a search input
// (Enter commits, Esc clears), pagination, and Loading / Empty / Error states. Unstyled: style
// the data-* hooks (data-status, data-initial-load, data-sort, data-invalid, …).
export function AllUsers({ users }: { users: User[] }) {
  return <DataTable data={users} rowKey="id" caption="Users" />
}

// Replace any part; the others stay built in.
const components: DataTableComponents = {
  Empty: ({ filtered }) => <p>{filtered ? 'No user matches.' : 'No users yet.'}</p>,
  Loading: () => <p role="status">Loading users…</p>,
}

// Or render a table you set up yourself (features, controlled state, a fetcher, …).
export function Oldest({ users }: { users: User[] }) {
  const table = useDataTable({
    data: users,
    rowKey: 'id',
    initialState: { sorting: { by: [{ id: 'age', desc: true }] } },
  })
  return <DataTable table={table} components={components} />
}
