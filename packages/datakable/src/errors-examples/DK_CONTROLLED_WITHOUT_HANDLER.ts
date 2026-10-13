import { createTable, sorting } from '@datakable/core'

const users = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Grace' },
]

const table = createTable({
  data: users,
  features: [sorting()],
  state: { sorting: { by: [] } }, // controlled, but nothing receives the updates
})
table.toggleSort('name')
