import { createTable, pagination } from '@datakable/core'

createTable({
  features: [pagination({ mode: 'server' })],
  // An API that never answers.
  fetcher: () => new Promise(() => {}),
  timeout: 50, // ms; the default is 30 s
})
