import { useDataTable } from '@datakable/react'

const users = [
  { id: 1, name: 'Ada', age: 36 },
  { id: 2, name: 'Grace', age: 45 },
]

export default function Users() {
  // A new columns array on every render.
  const table = useDataTable({ data: users, columns: [{ key: 'name' }, { key: 'age' }] })
  return <p>{table.rowModel.rows.length} users</p>
}
