// app/users/page.tsx — a server component. The data is loaded inside <Suspense>: with Next 16's
// cacheComponents, a page that awaits request data (searchParams, an uncached fetch) outside a
// Suspense boundary fails `next build`.
import type { FetchResult } from 'datakable'
import { Suspense } from 'react'
import { PAGE_SIZE, type User, UsersTable } from './1-users-table' // './users-table' in your app

type Props = { searchParams: Promise<{ page?: string }> }

export default function UsersPage(props: Props) {
  return (
    <Suspense fallback={<p>Loading users…</p>}>
      <Users {...props} />
    </Suspense>
  )
}

// Fetches the requested page while rendering; the HTML streams in with its rows.
async function Users(props: Props) {
  const { page } = await props.searchParams
  const pageIndex = Math.max(Number(page ?? 1) - 1, 0) || 0
  const res = await fetch(`https://api.example.com/users?page=${pageIndex}&size=${PAGE_SIZE}`, {
    cache: 'no-store',
  })
  const { rows, rowCount = rows.length } = (await res.json()) as FetchResult<User>
  return <UsersTable firstPage={[...rows]} rowCount={rowCount} pageIndex={pageIndex} />
}
