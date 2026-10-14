import { useDataTable } from 'datakable/react'

type User = { id: number; name: string; age: number }

const ARIA = { asc: 'ascending', desc: 'descending' } as const

export function UserTable({ users }: { users: User[] }) {
  const table = useDataTable({ data: users, rowKey: 'id' })
  const header = (id: 'name' | 'age', label: string) => {
    const dir = table.getSortDirection(id)
    return (
      <th aria-sort={dir ? ARIA[dir] : 'none'}>
        {/* Shift+click adds the column to the sort instead of replacing it. */}
        <button type="button" onClick={(e) => table.toggleSort(id, { multi: e.shiftKey })}>
          {label}
          {dir === 'asc' ? ' ▲' : dir === 'desc' ? ' ▼' : ''}
        </button>
      </th>
    )
  }
  return (
    <table>
      <thead>
        <tr>
          {header('name', 'Name')}
          {header('age', 'Age')}
        </tr>
      </thead>
      <tbody>
        {table.rowModel.rows.map((row) => (
          <tr key={row.key}>
            <td>{row.original.name}</td>
            <td>{row.original.age}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
