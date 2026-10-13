import type { ColumnDef } from 'datakable'
import type { ReactNode } from 'react'
import type { User } from './1-user'

export const columns: ColumnDef<User, ReactNode>[] = [
  // @ts-expect-error TS2820: 'address.ctiy' is not a path of User
  { key: 'address.ctiy' },
]
