import { DataTable } from 'datakable'

type User = { id: number; name: string; email: string; age: number; city: string }

const users: User[] = [
  { id: 1, name: 'Mali Srisuk', email: 'mali@example.com', age: 31, city: 'Bangkok' },
  { id: 2, name: 'Anan Wong', email: 'anan@example.com', age: 25, city: 'Chiang Mai' },
  { id: 3, name: 'Ploy Chai', email: 'ploy@example.com', age: 40, city: 'Bangkok' },
  { id: 4, name: 'Ada Lovelace', email: 'ada@example.com', age: 36, city: 'London' },
]

// Columns come from the data. Sort headers, a search input and pagination are built in.
export function UsersTable() {
  return <DataTable data={users} rowKey="id" caption="Users" />
}
