import { createTable } from '@datakable/core'
import { pagination } from '@datakable/core/pagination'
import { sorting } from '@datakable/core/sorting'

type User = { id: number; name: string; age: number }
declare const users: User[]

// Only what you install is bundled, in the state, and on the table's type.
const table = createTable({
  data: users,
  features: [sorting(), pagination({ pageSize: 25 })],
})

table.toggleSort('age')
table.nextPage()
// @ts-expect-error search() is not installed, so setSearch does not exist
void table.setSearch
// @ts-expect-error 'nope' is not a path of User
table.toggleSort('nope')
