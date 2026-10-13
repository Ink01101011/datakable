import { type SortingState, useDataTable } from 'datakable'
import { useEffect } from 'react'

type User = { id: number; name: string; age: number }

export function Users({ users }: { users: User[] }) {
  // The same initial state on the server and in the browser.
  const table = useDataTable({ data: users, rowKey: 'id' })
  const { setSorting } = table
  // Browser-only state (localStorage, window size, …) after hydration, not while rendering.
  useEffect(() => {
    const saved = localStorage.getItem('users.sorting')
    if (saved) setSorting((JSON.parse(saved) as SortingState<User>).by)
  }, [setSorting])
  return (
    <ul>
      {table.rowModel.rows.map((row) => (
        <li key={row.key}>{row.original.name}</li>
      ))}
    </ul>
  )
}
