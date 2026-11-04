import { createTable, search } from '@datakable/core'
import { withSearchFn } from '@datakable/core/search-async'

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
      // A search index that still holds user 7, which this page's data does not.
      searchFn: withSearchFn(async () => ({ keys: ['2', '7'] })),
    }),
  ],
})
await table.setSearch('gr') // shows Grace ('2' matches the key 2); '7' matches no row
