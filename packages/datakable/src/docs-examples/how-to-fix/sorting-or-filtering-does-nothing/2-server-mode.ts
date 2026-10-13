import { createTable, type FetchParams, type FetchResult, sorting, withFetcher } from 'datakable'

type User = { id: number; name: string; age: number }

async function fetchUsers({ sort, signal }: FetchParams): Promise<FetchResult<User>> {
  const order = (sort ?? []).map((s) => `${s.desc ? '-' : ''}${s.id}`).join(',')
  const res = await fetch(`/api/users?sort=${order}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as FetchResult<User> // { rows, rowCount }
}

export const table = createTable({
  rowKey: 'id',
  // The server sorts: the fetcher receives `sort` and runs again whenever it changes.
  features: [sorting({ mode: 'server' })],
  fetcher: withFetcher(fetchUsers),
})
