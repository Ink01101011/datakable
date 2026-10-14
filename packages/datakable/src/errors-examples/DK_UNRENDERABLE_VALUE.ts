import { createTable, search } from '@datakable/core'

// Untyped JSON: with a typed row, TypeScript asks for a format on an object column.
const users: Record<string, unknown>[] = [
  { id: 1, name: 'Ada', address: { city: 'London' } },
  { id: 2, name: 'Grace', address: { city: 'New York' } },
]

// `address` is an object: the default formatter cannot turn it into text.
const table = createTable({
  data: users,
  columns: [
    { key: 'name', search: 1 },
    { key: 'address', search: 1 },
  ],
  features: [search()],
})
await table.setSearch('london') // matches nothing: the address cells are ''
