import type { ColumnDef } from 'datakable'
import type { ReactNode } from 'react'
import type { User } from './1-user'

export const columns: ColumnDef<User, ReactNode>[] = [
  // @ts-expect-error TS2322: a string column takes 'contains' | 'equals' | 'in', not 'range'
  { key: 'first', filter: { type: 'range' } },
]
