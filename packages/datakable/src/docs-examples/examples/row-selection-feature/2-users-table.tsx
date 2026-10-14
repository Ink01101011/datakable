import { pagination, search, sorting, useDataTable } from 'datakable/react'
import { rowSelection } from './1-row-selection' // './row-selection' in your app

export type User = { id: number; name: string }

// Passing `features` replaces the default preset: list the built-ins you want next to yours.
const features = [search(), sorting(), pagination({ pageSize: 20 }), rowSelection()] as const

export function UsersTable({ users }: { users: User[] }) {
  const table = useDataTable({ data: users, rowKey: 'id', features })
  const { selected } = table.state.rowSelection // typed: RowSelectionState
  const pageKeys = table.rowModel.rows.map((row) => row.key)

  return (
    <section>
      <p>
        {selected.length} selected{' '}
        <button type="button" onClick={() => table.selectRows(pageKeys)}>
          Select page
        </button>{' '}
        <button type="button" onClick={table.clearSelection}>
          Clear
        </button>
      </p>
      <ul>
        {table.rowModel.rows.map((row) => (
          <li key={row.key}>
            <label>
              <input
                type="checkbox"
                checked={table.isRowSelected(row.key)}
                onChange={() => table.toggleRowSelected(row.key)}
              />
              {row.original.name}
            </label>
          </li>
        ))}
      </ul>
    </section>
  )
}
