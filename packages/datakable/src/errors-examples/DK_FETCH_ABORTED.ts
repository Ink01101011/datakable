import { createTable, type FetchResult, sorting } from '@datakable/core'
import { withFetcher } from '@datakable/core/server'

type User = { id: number; name: string }

const table = createTable({
  rowKey: 'id',
  features: [sorting({ mode: 'server' })],
  fetcher: withFetcher(
    ({ signal }) =>
      new Promise<FetchResult<User>>((resolve) => {
        const timer = setTimeout(() => resolve({ rows: [], rowCount: 0 }), 50)
        signal.addEventListener('abort', () => clearTimeout(timer))
      }),
  ),
})
table.toggleSort('name') // a new request supersedes the first one
