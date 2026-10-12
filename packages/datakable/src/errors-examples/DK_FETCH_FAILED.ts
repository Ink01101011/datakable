import { createTable, type FetchResult, pagination } from '@datakable/core'

type User = { id: number; name: string }

createTable({
  rowKey: 'id',
  features: [pagination({ mode: 'server' })],
  fetcher: async (): Promise<FetchResult<User>> => {
    throw new TypeError('Failed to fetch') // e.g. the API is unreachable
  },
})
