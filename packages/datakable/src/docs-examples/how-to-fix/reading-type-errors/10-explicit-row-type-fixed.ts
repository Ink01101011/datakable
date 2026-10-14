import { createTable, sorting } from 'datakable'
import type { User } from './1-user'

declare const users: User[]

// Fix 1: give no type argument; User is inferred from `data` and the features from `features`.
export const inferred = createTable({ data: users, rowKey: 'id', features: [sorting()] })

// Fix 2: keep the row type, and give the features' type as the third type argument.
const features = [sorting()] as const
export const explicit = createTable<User, never, typeof features>({
  data: users,
  rowKey: 'id',
  features,
})

inferred.toggleSort('age')
explicit.toggleSort('age')
