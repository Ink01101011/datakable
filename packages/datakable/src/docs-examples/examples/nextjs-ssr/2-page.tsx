// app/users/page.tsx — a server component: it fetches the first page while rendering.
import type { FetchResult } from 'datakable'
import { PAGE_SIZE, type User, UsersTable } from './1-users-table' // './users-table' in your app

export default async function UsersPage(props: { searchParams: Promise<{ page?: string }> }) {
  const { page } = await props.searchParams
  const pageIndex = Math.max(Number(page ?? 1) - 1, 0) || 0
  const res = await fetch(`https://api.example.com/users?page=${pageIndex}&size=${PAGE_SIZE}`, {
    cache: 'no-store',
  })
  const { rows, rowCount = rows.length } = (await res.json()) as FetchResult<User>
  return <UsersTable firstPage={[...rows]} rowCount={rowCount} pageIndex={pageIndex} />
}
