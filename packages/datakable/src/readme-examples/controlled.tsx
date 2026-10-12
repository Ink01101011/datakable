import { type SortingState, useDataTable } from 'datakable'
import { useState } from 'react'

type User = { id: number; name: string }

export function Users({ users }: { users: User[] }) {
  // Own one slice (e.g. to sync it with the URL); the store keeps the rest.
  const [sorting, setSorting] = useState<SortingState<User>>({ by: [] })
  const table = useDataTable({
    data: users,
    state: { sorting },
    onStateChange: (updater) => {
      const next = updater({ sorting })
      if (next.sorting) setSorting(next.sorting)
    },
  })
  return (
    <button type="button" onClick={() => table.toggleSort('name')}>
      Sort by name ({table.getSortDirection('name') || 'none'})
    </button>
  )
}
