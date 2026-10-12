import { createTable, sorting } from '@datakable/core'

const users = [
  { id: 1, name: 'Ångström' },
  { id: 2, name: 'Zed' },
]

// 'xx' is a well-formed locale tag that no ICU build has.
const table = createTable({ data: users, features: [sorting({ locale: 'xx' })] })
table.toggleSort('name')
table.getRowModel()
