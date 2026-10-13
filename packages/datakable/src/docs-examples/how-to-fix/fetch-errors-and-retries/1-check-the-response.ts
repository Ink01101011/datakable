import { createTable, type FetchParams, type FetchResult, pagination, withFetcher } from 'datakable'

type User = { id: number; name: string }
// What the API answers: { items, total }.
type UsersPage = { items: User[]; total: number }

async function fetchUsers({
  pageIndex,
  pageSize,
  signal,
}: FetchParams): Promise<FetchResult<User>> {
  const res = await fetch(`/api/users?page=${pageIndex}&size=${pageSize}`, { signal })
  // fetch() resolves on HTTP errors: throw, or the error body is taken for the rows.
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const page = (await res.json()) as UsersPage
  // Map the API's shape to { rows, rowCount } (rowCount: the total on the server).
  return { rows: page.items, rowCount: page.total }
}

export const table = createTable({
  rowKey: 'id',
  features: [pagination({ mode: 'server', pageSize: 20 })],
  fetcher: withFetcher(fetchUsers),
})
