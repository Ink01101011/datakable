import { createTable, type FetchResult, pagination } from '@datakable/core'
import { withFetcher } from '@datakable/core/server'

type User = { id: number; name: string }

createTable({
  rowKey: 'id',
  features: [pagination({ mode: 'server' })],
  // The API answers { items, total }; the fetcher returns it as is.
  fetcher: withFetcher(
    async () => ({ items: [{ id: 1, name: 'Ada' }], total: 1 }) as unknown as FetchResult<User>,
  ),
})
