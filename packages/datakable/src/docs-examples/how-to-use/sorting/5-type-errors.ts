import { createTable } from '@datakable/core'
import { sorting } from '@datakable/core/sorting'

type User = { id: number; name: string; address: { city: string } }
declare const users: User[]

const table = createTable({
  data: users,
  features: [sorting()],
  columns: [
    { key: 'name' },
    // @ts-expect-error an object column with sortable: true needs sortFn or sortBy
    { key: 'address', format: (a) => a.city, sortable: true },
  ],
})

// @ts-expect-error 'nmae' is not a path of User
table.toggleSort('nmae')
