import { createTable, sorting } from 'datakable'
import type { User } from './1-user'

declare const users: User[]

export const table = createTable<User>({
  data: users,
  rowKey: 'id',
  // @ts-expect-error TS2322: with only User given, `features` must be the default preset
  features: [sorting()],
})
