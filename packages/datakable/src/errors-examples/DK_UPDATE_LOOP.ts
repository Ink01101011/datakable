import { createTable, sorting } from '@datakable/core'

const users = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Grace' },
]
const table = createTable({ data: users, features: [sorting()] })

// A listener that changes the state on every notification: each change notifies it again.
table.subscribe(() => table.toggleSort('name'))
table.toggleSort('name')
