import {
  type FetchParams,
  type FetchResult,
  pagination,
  search,
  sorting,
  useDataTable,
  withFetcher,
} from 'datakable'

export type User = { id: number; name: string; email: string }

// Your API: GET /api/users?q=&sort=-name&page=0&size=20 → { rows: User[], rowCount: number }
async function fetchUsers({ query, sort, pageIndex, pageSize, signal }: FetchParams) {
  const params = new URLSearchParams({
    q: query ?? '',
    sort: (sort ?? []).map((s) => `${s.desc ? '-' : ''}${s.id}`).join(','),
    page: String(pageIndex ?? 0),
    size: String(pageSize ?? 20),
  })
  const res = await fetch(`/api/users?${params}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as FetchResult<User>
}

// Read once, at creation: define the features and the fetcher outside the component.
const features = [
  search({ mode: 'server' }), // typing is debounced 300 ms in server mode
  sorting({ mode: 'server' }),
  pagination({ mode: 'server', pageSize: 20 }),
] as const // a tuple: the table's type knows each feature's API
const fetcher = withFetcher(fetchUsers)

export function UsersTable() {
  const table = useDataTable({ rowKey: 'id', features, fetcher })
  const { rows, status, isInitialLoad } = table.rowModel
  const retry = () => void table.refetch()

  // Nothing to show yet: the first request is in flight, or failed.
  if (isInitialLoad) {
    return status === 'error' ? (
      <div role="alert">
        Could not load users.{' '}
        <button type="button" onClick={retry}>
          Retry
        </button>
      </div>
    ) : (
      <p role="status">Loading users…</p>
    )
  }

  return (
    <section aria-busy={status === 'fetching'}>
      <input
        type="search"
        aria-label="Search users"
        value={table.state.search.input}
        onChange={(e) => void table.setSearch(e.target.value)}
      />
      {/* Later requests keep the previous rows on screen: say so, don't blank the table. */}
      {status === 'fetching' && <p role="status">Updating…</p>}
      {status === 'error' && (
        <p role="alert">
          Could not refresh; showing the previous results.{' '}
          <button type="button" onClick={retry}>
            Retry
          </button>
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>
              <button type="button" onClick={() => table.toggleSort('name')}>
                Name
              </button>
            </th>
            <th>Email</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.original.name}</td>
              <td>{row.original.email}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p>No users match.</p>}
      <footer>
        <button type="button" disabled={!table.canPrevPage()} onClick={table.prevPage}>
          Previous
        </button>
        {/* The page count comes from the server's rowCount. */}
        <span>
          Page {table.state.pagination.pageIndex + 1} of {Math.max(table.getPageCount(), 1)}
        </span>
        <button type="button" disabled={!table.canNextPage()} onClick={table.nextPage}>
          Next
        </button>
      </footer>
    </section>
  )
}
