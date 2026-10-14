import { DataTable, pagination, sorting } from 'datakable/react'

type User = { id: number; name: string; age: number }

// `features` replaces the default preset: no search (and its search engine), no column filters.
const features = [sorting(), pagination({ pageSize: 25 })]

export function Users({ users }: { users: User[] }) {
  return <DataTable data={users} rowKey="id" features={features} />
}
