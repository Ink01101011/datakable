import { createTable } from '@datakable/core'

type User = { id?: number; email: string; name: string }
const users: User[] = [
  { id: 1, email: 'ada@example.com', name: 'Ada' },
  { email: 'grace@example.com', name: 'Grace' }, // no id yet (a draft row)
  { id: 3, email: 'linus@example.com', name: 'Linus' },
]

const table = createTable({ data: users, rowKey: 'id', columns: [{ key: 'name' }] })
table.getRowModel()
