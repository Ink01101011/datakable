import { createTable, sorting } from '@datakable/core'

const users = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Grace' },
]

// Restored from the URL: a hand-edited link left a null entry in the sort.
const saved = JSON.parse('{"sorting":{"by":[{"id":"name","desc":true},null]}}')

const table = createTable({ data: users, features: [sorting()], initialState: saved })
table.toggleSort('id') // works: the null entry was dropped
