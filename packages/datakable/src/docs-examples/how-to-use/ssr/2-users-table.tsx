'use client'
// app/users/users-table.tsx
import {
  DataTable,
  type FetchParams,
  type FetchResult,
  pagination,
  sorting,
  withFetcher,
} from 'datakable/react'

export type User = { id: number; name: string }

async function fetchUsers({ sort, pageIndex, pageSize, signal }: FetchParams) {
  const order = (sort ?? []).map((s) => `${s.desc ? '-' : ''}${s.id}`).join(',')
  const res = await fetch(`/api/users?sort=${order}&page=${pageIndex}&size=${pageSize}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as FetchResult<User>
}

const features = [sorting({ mode: 'server' }), pagination({ mode: 'server', pageSize: 20 })]
const fetcher = withFetcher(fetchUsers)

export function UsersTable({ firstPage, rowCount }: { firstPage: User[]; rowCount: number }) {
  // initialData answers the first request: the server HTML shows these rows, and hydration does
  // not fetch them again. Sorting or paging later fetches as usual.
  return (
    <DataTable
      rowKey="id"
      features={features}
      fetcher={fetcher}
      initialData={firstPage}
      rowCount={rowCount}
    />
  )
}
