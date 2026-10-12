import { createTable, pagination, sorting } from '@datakable/core'

createTable({
  // Sorting in the browser, but paging on the server: the client sort would see one page only.
  features: [sorting(), pagination({ mode: 'server' })],
  fetcher: async () => ({ rows: [], rowCount: 0 }),
})
