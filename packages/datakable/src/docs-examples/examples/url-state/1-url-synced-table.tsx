import { type PaginationState, type SearchState, type SortingState, useDataTable } from 'datakable'
import { useEffect, useState } from 'react'

export type User = { id: number; name: string; age: number }

// The slices the URL owns. `?q=ada&sort=-age&page=2` ⇄ search, sorting and pagination.
type UrlState = {
  search: SearchState
  sorting: SortingState<User>
  pagination: PaginationState
}

const SORTABLE = ['name', 'age'] as const

export function readUrl(query: string, pageSize = 20): UrlState {
  const params = new URLSearchParams(query)
  const q = params.get('q') ?? ''
  const sort = params.get('sort') ?? ''
  const id = SORTABLE.find((c) => c === sort.replace(/^-/, ''))
  const page = Number(params.get('page'))
  return {
    search: { input: q, query: q, status: 'idle' },
    sorting: { by: id ? [{ id, desc: sort.startsWith('-') }] : [] },
    pagination: { pageIndex: Number.isInteger(page) && page > 1 ? page - 1 : 0, pageSize },
  }
}

export function writeUrl({ search, sorting, pagination }: UrlState): string {
  const params = new URLSearchParams()
  if (search.query) params.set('q', search.query)
  const [first] = sorting.by
  if (first) params.set('sort', `${first.desc ? '-' : ''}${first.id}`)
  if (pagination.pageIndex > 0) params.set('page', String(pagination.pageIndex + 1))
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function UsersTable({ users }: { users: User[] }) {
  // Controlled slices: the component owns them, the table reports every change.
  const [state, setState] = useState(() => readUrl(window.location.search))
  const table = useDataTable({
    data: users,
    rowKey: 'id',
    state,
    onStateChange: (updater) => setState((prev) => ({ ...prev, ...updater(prev) })),
  })

  // State → URL. replaceState: typing or paging does not flood the back button.
  useEffect(() => {
    const next = writeUrl(state)
    if (next !== window.location.search) {
      window.history.replaceState(null, '', `${window.location.pathname}${next}`)
    }
  }, [state])

  return (
    <section>
      <input
        type="search"
        aria-label="Search users"
        value={table.state.search.input}
        onChange={(e) => void table.setSearch(e.target.value)}
      />
      <button type="button" onClick={() => table.toggleSort('age')}>
        Sort by age ({table.getSortDirection('age') || 'none'})
      </button>
      <ol>
        {table.rowModel.rows.map((row) => (
          <li key={row.key}>
            {row.original.name} ({row.original.age})
          </li>
        ))}
      </ol>
      <button type="button" disabled={!table.canNextPage()} onClick={table.nextPage}>
        Next page
      </button>
    </section>
  )
}
