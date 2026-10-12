import { createTable, pagination } from '@datakable/core'

createTable({
  features: [pagination()], // client mode (the default)
  fetcher: async () => ({ rows: [], rowCount: 0 }),
})
