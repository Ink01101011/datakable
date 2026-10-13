import { createTable } from '@datakable/core'
import { pagination } from '@datakable/core/pagination'
import { sorting } from '@datakable/core/sorting'

type User = { id: number; name: string; age: number }
declare const users: User[]

// `features` replaces the preset: only these two are installed, bundled and typed.
const table = createTable({
  data: users,
  rowKey: 'id',
  features: [sorting(), pagination({ pageSize: 25 })],
})

table.toggleSort('age')
console.log(table.getState().pagination.pageSize) // 25

// @ts-expect-error search() is not installed: no setSearch method
void table.setSearch
// @ts-expect-error nor a search slice in the state
void table.getState().search
