import { createTable, type FetchParams, type FetchResult } from '@datakable/core'
import { pagination } from '@datakable/core/pagination'
import { withFetcher } from '@datakable/core/server'
import { sorting } from '@datakable/core/sorting'

type User = { id: number; name: string }
declare function fetchUsers(params: FetchParams): Promise<FetchResult<User>>

// Each import brings one part: the bare table, two features and the server source. Search,
// filters, schema validation and the async search engine are not bundled.
const table = createTable({
  rowKey: 'id',
  features: [sorting({ mode: 'server' }), pagination({ mode: 'server', pageSize: 20 })],
  fetcher: withFetcher(fetchUsers),
})
table.toggleSort('name')
