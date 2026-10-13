import { type ColumnDef, createTable } from '@datakable/core'

type User = { id: number; name: string; address: { city: string }; onClick: () => void }
declare const users: User[]

export const columns: ColumnDef<User>[] = [
  // @ts-expect-error 'nmae' is not a path of User
  { key: 'nmae' },
  // @ts-expect-error an object column needs `cell` or `format`
  { key: 'address' },
  // @ts-expect-error 'range' is a number / bigint / Date filter, and name is a string
  { key: 'name', filter: { type: 'range' } },
  // @ts-expect-error sortable: true on an object column needs `sortFn` or `sortBy`
  { key: 'address', format: (a) => a.city, sortable: true },
  { key: 'address', format: (a) => a.city, sortable: true, sortBy: (u) => u.address.city },
]

// @ts-expect-error rowKey must be a path of User (or a function)
createTable({ data: users, rowKey: 'uuid' })
