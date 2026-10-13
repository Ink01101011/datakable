import { createTable } from 'datakable'

type User = { id: number; name: string }
declare const users: User[]

const table = createTable({ data: users, rowKey: 'id' })
const unsubscribe = table.subscribe((state) => console.log(state.pagination.pageIndex))

// When the table is no longer needed (a React component unmounting does this for you):
unsubscribe()
table.destroy()

// Later calls are no-ops that report DK_TABLE_DESTROYED; promise methods still resolve.
const { status } = await table.setSearch('mali')
console.log(status) // 'superseded'
