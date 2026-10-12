import { DataTable, type FetchParams, type FetchResult, pagination, sorting } from 'datakable'

type User = { id: number; name: string }

async function fetchUsers({ sort, pageIndex, pageSize, signal }: FetchParams) {
  const order = (sort ?? []).map((s) => `${s.desc ? '-' : ''}${s.id}`).join(',')
  const res = await fetch(`/api/users?sort=${order}&page=${pageIndex}&size=${pageSize}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as FetchResult<User> // { rows, rowCount }
}

// Read once, at creation: define features outside the component.
const features = [sorting({ mode: 'server' }), pagination({ mode: 'server', pageSize: 20 })]

// Rendered on the server, then hydrated. `firstPage` / `rowCount` were fetched on the server
// for the same initial state (e.g. parsed from the URL and passed as `initialState`).
export function Users({ firstPage, rowCount }: { firstPage: User[]; rowCount: number }) {
  return (
    <DataTable
      rowKey="id"
      features={features}
      fetcher={fetchUsers}
      // The server HTML shows these rows and hydration does not fetch them again. Without
      // initialData nothing is fetched on the server: the HTML shows Loading (status 'pending',
      // DK_SSR_ASYNC_DEFERRED) and the browser fetches right after hydrating.
      initialData={firstPage}
      rowCount={rowCount}
    />
  )
}
