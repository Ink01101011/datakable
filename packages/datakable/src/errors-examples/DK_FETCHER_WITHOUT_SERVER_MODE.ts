import { createTable, pagination } from '@datakable/core'
import { withFetcher } from '@datakable/core/server'

createTable({
  features: [pagination()], // client mode (the default)
  fetcher: withFetcher(async () => ({ rows: [], rowCount: 0 })),
})
