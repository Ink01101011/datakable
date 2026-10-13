import { pagination, sorting } from '@datakable/core'
import { useDataTable } from '@datakable/react'

type User = { id: number; name: string }

// `features` is read once, at creation. Hoist the array with `as const`: a plain array type
// loses which features it holds, and with it their methods and state on the table's type.
const features = [sorting(), pagination({ pageSize: 20 })] as const

export function Users({ users }: { users: User[] }) {
  // @datakable/react installs only the features you pass.
  const table = useDataTable({ data: users, rowKey: 'id', features })
  return (
    <button type="button" onClick={() => table.toggleSort('name')}>
      Name {table.getSortDirection('name') || ''}
    </button>
  )
}
