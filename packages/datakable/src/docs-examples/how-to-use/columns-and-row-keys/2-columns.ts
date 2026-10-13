import { createTable } from '@datakable/core'
import { columnFilters } from '@datakable/core/column-filters'
import { search } from '@datakable/core/search'
import { sorting } from '@datakable/core/sorting'

type User = {
  id: number
  name: string
  email: string
  age: number
  joined: Date
  tags: string[]
  address: { city: string; zip: string }
  manager: { name: string } | null
}
declare const users: User[]

const table = createTable({
  data: users,
  rowKey: 'id',
  features: [columnFilters(), search(), sorting()],
  columns: [
    { key: 'name', header: 'Name', search: 2 }, // search weight 2
    { key: 'age', header: 'Age', filter: { type: 'range' } },
    { key: 'joined', header: 'Joined', format: (d) => d.toISOString().slice(0, 10) },
    { key: 'tags', search: 1 }, // arrays of primitives render joined: "a, b"
    { key: 'address.city', header: 'City', search: 1 }, // a dot-path, typed against User
    { key: 'manager.name', header: 'Manager' }, // a nullable parent is fine
    { key: 'address', format: (a) => `${a.city} ${a.zip}` }, // an object needs format or cell
    { key: 'email', sensitive: true }, // never written to diagnostics
  ],
})

table.toggleSort('address.city')
