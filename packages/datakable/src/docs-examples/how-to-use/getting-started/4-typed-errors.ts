import { createTable } from 'datakable'

type User = { id: number; name: string; age: number }
declare const users: User[]

const table = createTable({ data: users, rowKey: 'id' })

// Column ids are dot-paths of User and filters are checked against the value type:
// @ts-expect-error 'nmae' is not a path of User
table.toggleSort('nmae')
// @ts-expect-error a range filter needs a number, bigint or Date column
table.setColumnFilter('name', { type: 'range', value: { min: 1 } })
