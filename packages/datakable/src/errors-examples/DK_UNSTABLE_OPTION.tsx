import { useDataTable } from '@datakable/react'

const users = [
  { id: 1, name: 'Ada', age: 36 },
  { id: 2, name: 'Grace', age: 17 },
]
const columns = [{ key: 'name' }, { key: 'age' }] as const

export default function Adults({ minAge = 18 }: { minAge?: number }) {
  // A new (filtered) data array on every render.
  const table = useDataTable({ data: users.filter((u) => u.age >= minAge), columns })
  return <p>{table.rowModel.rows.length} adults</p>
}
