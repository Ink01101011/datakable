// app/users/page.tsx — a server component: it fetches the first page for the initial state
// (page 0, unsorted, 20 rows), and the client component renders and hydrates it. The fetch runs
// inside <Suspense>, as Next 16's cacheComponents requires for uncached data.
import { Suspense } from 'react'
import { type User, UsersTable } from './2-users-table'

declare function queryUsers(opts: {
  page: number
  size: number
}): Promise<{ rows: User[]; total: number }>

export default function Page() {
  return (
    <Suspense fallback={<p>Loading users…</p>}>
      <FirstPage />
    </Suspense>
  )
}

async function FirstPage() {
  const { rows, total } = await queryUsers({ page: 0, size: 20 })
  return <UsersTable firstPage={rows} rowCount={total} />
}
