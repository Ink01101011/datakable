import { columnFilters, createTable } from '@datakable/core'

const users = [
  { id: 1, name: 'Ada', team: 'core' },
  { id: 2, name: 'Grace', team: 'compilers' },
]

// Saved before the column `group` was renamed to `team`.
const saved = JSON.parse('{"columnFilters":{"group":{"type":"equals","value":"core"}}}')

const table = createTable({ data: users, features: [columnFilters()], initialState: saved })
table.getRowModel()
