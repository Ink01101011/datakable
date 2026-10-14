'use client'
// app/users/users-table.tsx — a client component: it holds the table and its event handlers.

import {
  DataTable,
  type FetchParams,
  type FetchResult,
  pagination,
  sorting,
  withFetcher,
} from 'datakable/react'

export type User = { id: number; name: string; email: string }

export const PAGE_SIZE = 20

// Later pages (after a sort or page change) are fetched by the browser, from your route handler.
async function fetchUsers({ sort, pageIndex, pageSize, signal }: FetchParams) {
  const order = (sort ?? []).map((s) => `${s.desc ? '-' : ''}${s.id}`).join(',')
  const res = await fetch(`/api/users?sort=${order}&page=${pageIndex}&size=${pageSize}`, {
    signal,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as FetchResult<User>
}

const features = [sorting({ mode: 'server' }), pagination({ mode: 'server', pageSize: PAGE_SIZE })]
const fetcher = withFetcher(fetchUsers)

export function UsersTable(props: { firstPage: User[]; rowCount: number; pageIndex: number }) {
  return (
    <DataTable
      rowKey="id"
      features={features}
      fetcher={fetcher}
      // The server already fetched this page for this state: the HTML shows its rows, and
      // hydration does not fetch it again.
      initialData={props.firstPage}
      rowCount={props.rowCount}
      initialState={{ pagination: { pageIndex: props.pageIndex, pageSize: PAGE_SIZE } }}
      caption="Users"
    />
  )
}
