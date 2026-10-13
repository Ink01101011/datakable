import { createTable } from '@datakable/core'

type User = { id: number; name: string; email?: string }
const users: User[] = [
  { id: 1, name: 'Ada', email: 'ada@example.com' },
  { id: 2, name: 'Grace' },
  { id: 3, name: 'Linus', email: 'linus@example.com' },
  { id: 4, name: 'Margaret' },
]

createTable({ data: users, columns: [{ key: 'name' }, { key: 'email' }] })
