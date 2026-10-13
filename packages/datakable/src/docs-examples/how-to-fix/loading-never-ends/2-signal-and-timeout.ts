import { createTable, type FetchParams, type FetchResult, pagination, withFetcher } from 'datakable'

type User = { id: number; name: string }

async function fetchUsers({ pageIndex, pageSize, signal }: FetchParams) {
  // Pass the signal: a superseded or timed-out request is aborted, not left running.
  const res = await fetch(`/api/users?page=${pageIndex}&size=${pageSize}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as FetchResult<User>
}

export const table = createTable({
  rowKey: 'id',
  features: [pagination({ mode: 'server', pageSize: 20 })],
  fetcher: withFetcher(fetchUsers),
  // A request still running after 10 s fails with DK_ASYNC_TIMEOUT (the default is 30 s).
  timeout: 10_000,
})
