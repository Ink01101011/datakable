import { createTable } from '@datakable/core'

const users = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Grace' },
]
const table = createTable({ data: users, rowKey: 'id' })

users.push({ id: 3, name: 'Linus' }) // mutates the array the table already has
table.setOptions({ data: users }) // same reference: the table still shows 2 rows
