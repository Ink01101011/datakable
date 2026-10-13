import { createTable } from 'datakable'

type User = { id: number; name: string; age: number; joined: Date }
declare const users: User[]

// No `columns`: one column per top-level key of the first 50 rows (id, name, age, joined).
const table = createTable({ data: users, rowKey: 'id' })

const row = table.getRowModel().rows[0]
console.log(row?.getValue('joined')) // the Date; rendered with toLocaleString()
