import { useDataTable } from 'datakable'

type User = { id: number; name: string }

export function UserSearch({ users }: { users: User[] }) {
  const table = useDataTable({ data: users, rowKey: 'id' })
  const { input, status } = table.state.search
  return (
    <div>
      <input
        type="search"
        aria-label="Search users"
        // Bind to `input` (what the user typed), not `query` (what is applied).
        value={input}
        onChange={(e) => void table.setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void table.flushSearch()
          else if (e.key === 'Escape') table.clearSearch()
        }}
      />
      {status === 'pending' || status === 'searching' ? (
        <span role="status">Searching…</span>
      ) : null}
      <p>{table.rowModel.filteredCount} matches</p>
    </div>
  )
}
