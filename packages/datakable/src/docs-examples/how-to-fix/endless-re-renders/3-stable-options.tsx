import { type ColumnDef, useDataTable } from 'datakable/react'
import { type ReactNode, useMemo } from 'react'

type User = { id: number; name: string; age: number }

// Created once, outside the component.
const columns: ColumnDef<User, ReactNode>[] = [{ key: 'name' }, { key: 'age' }]

export function Adults({ users, minAge }: { users: User[]; minAge: number }) {
  // A new array only when the inputs change, not on every render.
  const adults = useMemo(() => users.filter((user) => user.age >= minAge), [users, minAge])
  const table = useDataTable({ data: adults, rowKey: 'id', columns })
  return <p>{table.rowModel.filteredCount} adults</p>
}
