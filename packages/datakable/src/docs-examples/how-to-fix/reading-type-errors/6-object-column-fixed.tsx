import type { ColumnDef } from 'datakable'
import type { ReactNode } from 'react'
import type { User } from './1-user'

// Any one of these: text with `format`, a component with `cell`, or a displayable leaf.
export const withFormat: ColumnDef<User, ReactNode>[] = [
  { key: 'address', format: (address) => address.city },
]
export const withCell: ColumnDef<User, ReactNode>[] = [
  { key: 'address', cell: ({ value }) => <em>{value.city}</em> },
]
export const withLeaf: ColumnDef<User, ReactNode>[] = [{ key: 'address.city' }]

// An array of objects is fixed the same way.
export const friends: ColumnDef<User, ReactNode>[] = [
  { key: 'friends', format: (list) => `${list.length} friends` },
]
