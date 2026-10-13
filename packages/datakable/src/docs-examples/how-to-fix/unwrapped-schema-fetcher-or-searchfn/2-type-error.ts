import { createTable, type FetchResult, pagination } from 'datakable'

type User = { id: number; name: string }
declare function fetchUsers(): Promise<FetchResult<User>>

createTable({
  rowKey: 'id',
  features: [pagination({ mode: 'server' })],
  // @ts-expect-error a bare function: wrap it with withFetcher(fetchUsers)
  fetcher: fetchUsers,
})
