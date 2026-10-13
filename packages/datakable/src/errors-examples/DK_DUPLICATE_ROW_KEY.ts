import { createTable } from '@datakable/core'

const users = [
  { id: 7, uuid: 'a1', name: 'Ada' },
  { id: 42, uuid: 'b2', name: 'Grace' },
  { id: 42, uuid: 'c3', name: 'Linus' },
]

const table = createTable({ data: users, rowKey: 'id' })
table.getRowModel()
