# A server-side table with loading, error and retry

When the data lives on a server, the table sends its state (search query, sort, page) to your
`fetcher` and shows what comes back. This recipe builds the UI around the request: a first load,
refreshes over the current rows, and errors you can retry.

## Goal

Search, sort and paginate users on the server, with a loading state for the first request, an
"Updating…" note for later ones, and a Retry button when a request fails.

## The code

```tsx
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
```

## What you will see

- "Loading users…" until the first response, then the first 20 users and `Page 1 of 3` for a
  `rowCount` of 45.
- Clicking Name requests `sort=name`, then `sort=-name`. Next requests `page=1`. Typing waits
  300 ms after the last keystroke (and for at least 2 characters), then requests `q=…` from
  page 1.
- While a later request is in flight, the current rows stay on screen with "Updating…": a refresh
  never blanks the table. A superseded request is aborted through `signal`.
- If the first request fails, the alert "Could not load users." with Retry. If a later one fails,
  the previous rows stay with "Could not refresh; showing the previous results." and Retry, which
  calls `refetch()` with the current state.
- The failures are also reported as `DK_FETCH_FAILED` (or `DK_ASYNC_TIMEOUT` after 30 s).

## Variations

- **Use `<DataTable />`:** `<DataTable table={table} />` renders the same states (Loading, Error
  with a retry, a refresh indicator over stale rows); replace any of them with `components`.
- **Mix modes:** server steps must come first in the pipeline (filter → search → sort →
  paginate). Server search with client sorting and pagination is fine; client search before
  server pagination throws `DK_MODE_ORDER` at creation (a development check).
- **Timeout:** `useDataTable({ …, timeout: 10_000 })`, read once at creation.
- **No fetcher:** fetch in your own code and pass each page as `data` with `rowCount`; the table
  only holds the server-mode state ([server mode](../../packages/core/README.md#server-mode)).
- **Validate the response:** add `schema` and the fetched rows are validated like any data
  ([Schema validation](schema-validation.md)).

## See also

- [Server mode](../../packages/core/README.md#server-mode) and the
  [status model](../../packages/core/README.md#status-model) in `@datakable/core`.
- [How to fix](../how-to-fix/README.md) — `DK_FETCH_FAILED`, `DK_FETCH_BAD_RESPONSE`,
  `DK_FETCHER_WITHOUT_SERVER_MODE`.
- [Examples](README.md)
