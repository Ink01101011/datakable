import { type SortEntry, useDataTable } from 'datakable/react'

type User = { id: number; name: string; age: number }

/** `?q=ada&sort=-age&page=2` → the table's starting state, the same on the server and client. */
function stateFromUrl(params: URLSearchParams) {
  const q = params.get('q') ?? ''
  const sort = params.get('sort')
  const by: SortEntry<User>[] =
    sort === 'age' || sort === '-age' ? [{ id: 'age', desc: sort.startsWith('-') }] : []
  return {
    search: { input: q, query: q, status: 'idle' as const },
    sorting: { by },
    pagination: { pageIndex: Math.max(0, Number(params.get('page') ?? 1) - 1), pageSize: 20 },
  }
}

export function Users({ users, search }: { users: User[]; search: string }) {
  // Read once, at creation. Client-mode features apply it while rendering on the server, so the
  // HTML is already searched, sorted and on the right page.
  const table = useDataTable({
    data: users,
    rowKey: 'id',
    initialState: stateFromUrl(new URLSearchParams(search)),
  })
  return (
    <ul>
      {table.rowModel.rows.map((row) => (
        <li key={row.key}>{row.original.name}</li>
      ))}
    </ul>
  )
}
