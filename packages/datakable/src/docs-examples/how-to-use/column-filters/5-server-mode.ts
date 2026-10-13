import { createTable, type FetchResult } from '@datakable/core'
import { columnFilters } from '@datakable/core/column-filters'
import { withFetcher } from '@datakable/core/server'

type User = { id: number; name: string; city: string }

const table = createTable({
  rowKey: 'id',
  // Server mode: core skips the filter step; the slice goes to the fetcher as `filters`.
  features: [columnFilters({ mode: 'server' })],
  fetcher: withFetcher(async ({ filters, signal }) => {
    const res = await fetch(`/api/users?filters=${JSON.stringify(filters ?? {})}`, { signal })
    return (await res.json()) as FetchResult<User>
  }),
})

table.setColumnFilter('city', { type: 'equals', value: 'Bangkok' }) // fetches again
