import { createTable, search } from '@datakable/core'

type User = { id: number; name: string }
const users: User[] = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Grace' },
]

const table = createTable({
  data: users,
  rowKey: 'id',
  features: [
    search<User>({
      // A search service that is down.
      searchFn: async () => {
        throw new TypeError('Failed to fetch')
      },
    }),
  ],
})
await table.setSearch('ada')
