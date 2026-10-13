import { type SortingState, useDataTable } from 'datakable'
import { useState } from 'react'

type User = { id: number; name: string; age: number }

export function Users({ users }: { users: User[] }) {
  const [sorting, setSorting] = useState<SortingState<User>>({ by: [] })
  const table = useDataTable({
    data: users,
    rowKey: 'id',
    state: { sorting },
    // The table asks; you decide. Feed the result back, or every sort is dropped.
    onStateChange: (updater) => {
      const next = updater({ sorting })
      if (next.sorting) setSorting(next.sorting)
    },
  })
  return (
    <>
      <button type="button" onClick={() => table.toggleSort('age')}>
        Sort by age
      </button>
      <ol>
        {table.rowModel.rows.map((row) => (
          <li key={row.key}>{row.original.name}</li>
        ))}
      </ol>
    </>
  )
}
