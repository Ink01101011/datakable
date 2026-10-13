import { createTable } from '@datakable/core'
import { columnFilters } from '@datakable/core/column-filters'
import { sorting } from '@datakable/core/sorting'

type User = {
  id: number
  name: string
  email: string
  age: number
  joined: Date
  address: { city: string; zip: string }
  manager: { name: string } | null
}
declare const users: User[]

const table = createTable({
  data: users,
  rowKey: 'id',
  features: [columnFilters(), sorting()],
  columns: [
    { key: 'name', header: 'Name', search: 1 }, // search weight
    { key: 'age', filter: { type: 'range' } },
    { key: 'joined', sortAlgorithm: 'native' },
    { key: 'address.city', search: 0.5 }, // dot-paths, typed against User
    { key: 'manager.name' }, // nullable parents are fine
    { key: 'address', format: (a) => `${a.city} ${a.zip}` }, // objects need format or cell
    { key: 'email', sensitive: true }, // never written to diagnostics
    { id: 'label', accessor: (u) => `${u.name} (${u.age})` }, // derived column
  ],
})

table.setColumnFilter('age', { type: 'range', value: { min: 18, max: 65 } })
// @ts-expect-error 'range' needs a number / bigint / Date column
table.setColumnFilter('name', { type: 'range', value: { min: 1 } })
