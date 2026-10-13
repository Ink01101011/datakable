import { type FetchParams, type FetchResult, pagination } from '@datakable/core'
import { withFetcher } from '@datakable/core/server'
import { DataTable } from '@datakable/react'
import { renderToString } from 'react-dom/server'

type User = { id: number; name: string }

async function fetchUsers({ pageIndex, signal }: FetchParams): Promise<FetchResult<User>> {
  const res = await fetch(`/api/users?page=${pageIndex}`, { signal })
  return res.json()
}
const features = [pagination({ mode: 'server' })]

function Users() {
  // No initialData: the server has no rows to render.
  return <DataTable rowKey="id" features={features} fetcher={withFetcher(fetchUsers)} />
}

// In the server render (Next.js, Remix, a Node server, …).
renderToString(<Users />)
