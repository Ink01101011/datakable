// app/users/page.tsx — a server component: it fetches the first page for the initial state
// (page 0, unsorted, 20 rows), and the client component renders and hydrates it.
import { type User, UsersTable } from './2-users-table'

declare function queryUsers(opts: {
  page: number
  size: number
}): Promise<{ rows: User[]; total: number }>

export default async function Page() {
  const { rows, total } = await queryUsers({ page: 0, size: 20 })
  return <UsersTable firstPage={rows} rowCount={total} />
}
