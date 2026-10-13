import { createTable } from 'datakable'
import type { User } from './1-user'

declare const users: User[]

export const table = createTable({
  data: users,
  // @ts-expect-error TS2322: 'nope' is not a path of User
  rowKey: 'nope',
})
