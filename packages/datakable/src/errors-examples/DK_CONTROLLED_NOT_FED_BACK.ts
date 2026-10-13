import { createTable, sorting } from '@datakable/core'

const users = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Grace' },
]

const table = createTable({
  data: users,
  features: [sorting()],
  state: { sorting: { by: [] } },
  onStateChange: (updater) => {
    console.log(updater({})) // receives the change, but never passes it back in state
  },
})
table.toggleSort('name')
