import { createTable, pagination } from '@datakable/core'
import { withFetcher } from '@datakable/core/server'

createTable({
  features: [pagination({ mode: 'server' })],
  // An API that never answers.
  fetcher: withFetcher(() => new Promise(() => {})),
  timeout: 50, // ms; the default is 30 s
})
