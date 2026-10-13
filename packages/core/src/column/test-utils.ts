import type { ColumnDef } from './column-def'
import type { Path } from './path'

/** Row fixture from the brainstorm prototype (`proto.ts`). */
export type User = {
  id: number
  first: string
  last: string
  age: number
  active: boolean
  createdAt: Date
  tags: string[]
  nick?: string
  address: { city: string; geo: { lat: number; lng: number } }
  manager: { name: string } | null
  onClick: () => void
  friends: { id: number }[]
}

/**
 * Type-test stand-in for the table entry point: the prototype `useDataTable` signature.
 * Declared only — type tests never execute it.
 */
export declare function table<T extends object, R = string>(options: {
  data: readonly T[]
  rowKey: Path<T>
  columns?: readonly ColumnDef<T, R>[]
}): T
