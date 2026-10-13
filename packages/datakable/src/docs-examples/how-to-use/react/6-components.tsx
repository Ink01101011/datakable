import {
  DataTable,
  type DataTableComponents,
  type ErrorProps,
  type PaginationProps,
  type SearchInputProps,
} from 'datakable'

function Search({ value, status, onChange, onSubmit, onClear }: SearchInputProps) {
  return (
    <input
      type="search"
      placeholder="Search users"
      value={value}
      aria-busy={status === 'pending' || status === 'searching'}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSubmit()
        if (e.key === 'Escape') onClear()
      }}
    />
  )
}

function Pager({ pageIndex, pageCount, canPrev, canNext, prev, next }: PaginationProps) {
  return (
    <nav aria-label="Pages">
      <button type="button" disabled={!canPrev} onClick={prev}>
        Previous
      </button>
      {pageIndex + 1} / {Math.max(pageCount, 1)}
      <button type="button" disabled={!canNext} onClick={next}>
        Next
      </button>
    </nav>
  )
}

function Failed({ reason, retry }: ErrorProps) {
  return (
    <p role="alert">
      {reason === 'load' ? 'Could not load users.' : 'Could not show users.'}{' '}
      <button type="button" onClick={retry}>
        Try again
      </button>
    </p>
  )
}

// Hoisted: one object for every render. Parts you leave out stay built in.
const components: DataTableComponents = {
  SearchInput: Search,
  Pagination: Pager,
  Empty: ({ filtered }) => <p>{filtered ? 'No user matches.' : 'No users yet.'}</p>,
  Loading: () => <p role="status">Loading users…</p>,
  Error: Failed,
}

type User = { id: number; name: string }

export function Users({ users }: { users: User[] }) {
  return <DataTable data={users} rowKey="id" components={components} />
}
