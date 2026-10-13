import { createTable } from '@datakable/core'
import { pagination } from '@datakable/core/pagination'

type User = { id: number; name: string }
declare const users: User[] // say 45 users

const table = createTable({ data: users, rowKey: 'id', features: [pagination({ pageSize: 20 })] })

const { rows, filteredCount } = table.getRowModel()
console.log(rows.length, filteredCount) // 20 45: rows is the current page only
console.log(table.getPageCount()) // 3

table.nextPage() // page 1 (0-based)
table.setPageIndex(10) // clamped to the last page: 2
console.log(table.canNextPage(), table.canPrevPage()) // false true

table.setPageSize(10) // keeps the first visible row (row 40) on screen: page 4
console.log(table.getState().pagination) // { pageIndex: 4, pageSize: 10 }
