import { createTable, pagination } from '@datakable/core'

// Server pagination with the page passed as data (no fetcher), but no total.
const page = [
  { id: 21, name: 'Ada' },
  { id: 22, name: 'Grace' },
]

const table = createTable({ data: page, features: [pagination({ mode: 'server', pageSize: 20 })] })
table.getPageCount() // 1: the total is unknown
