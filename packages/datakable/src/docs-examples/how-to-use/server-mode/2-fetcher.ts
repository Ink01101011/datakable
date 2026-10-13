import { createTable, type FetchParams, type FetchResult } from '@datakable/core'
import { columnFilters } from '@datakable/core/column-filters'
import { pagination } from '@datakable/core/pagination'
import { search } from '@datakable/core/search'
import { withFetcher } from '@datakable/core/server'
import { sorting } from '@datakable/core/sorting'

type Order = { id: string; customer: string; total: number }

// Receives only the state of the server-mode features, and an AbortSignal.
async function fetchOrders({ query, filters, sort, pageIndex, pageSize, signal }: FetchParams) {
  const params = new URLSearchParams({
    q: query ?? '',
    filters: JSON.stringify(filters ?? {}),
    sort: (sort ?? []).map((s) => `${s.desc ? '-' : ''}${s.id}`).join(','),
    page: String(pageIndex),
    size: String(pageSize),
  })
  const res = await fetch(`/api/orders?${params}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  // rowCount is the total on the server: required with server-mode pagination.
  return (await res.json()) as FetchResult<Order>
}

const table = createTable({
  rowKey: 'id',
  features: [
    columnFilters({ mode: 'server' }),
    search({ mode: 'server' }), // typing: debounce 300 ms, minLength 2
    sorting({ mode: 'server' }),
    pagination({ mode: 'server', pageSize: 20 }),
  ],
  // Wrapped with withFetcher: a table without a fetcher does not bundle the server source.
  fetcher: withFetcher(fetchOrders),
  timeout: 10_000, // default 30 000 ms; Infinity disables it
})

// Runs at creation, then on every change of the server-mode state: here, one request for page 2.
table.nextPage()
