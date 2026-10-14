import { createTable, search } from '@datakable/core'

const users = [
  { id: 1, name: 'Ada', joined: new Date(Date.UTC(2020, 0, 15)) },
  { id: 2, name: 'Grace', joined: new Date(Date.UTC(2024, 5, 1)) },
]

// Zero-config: no column declares a search weight, so `joined` (dates) is not searched.
const table = createTable({ data: users, rowKey: 'id', features: [search()] })
await table.setSearch('2020') // matches nothing: only `id` and `name` are searched
