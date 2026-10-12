import { createTable, sorting } from '@datakable/core'

const users = Array.from({ length: 1000 }, (_, i) => ({ id: i, age: (i * 7919) % 90 }))

const table = createTable({ data: users, features: [sorting({ debug: true })] })
table.toggleSort('age')
table.getRowModel()
