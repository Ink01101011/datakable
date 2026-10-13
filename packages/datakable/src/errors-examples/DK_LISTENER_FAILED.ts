import { createTable, sorting } from '@datakable/core'

const users = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Grace' },
]
const table = createTable({ data: users, features: [sorting()] })

table.subscribe(() => {
  throw new Error('render failed') // e.g. a UI update that throws
})
table.toggleSort('name')
