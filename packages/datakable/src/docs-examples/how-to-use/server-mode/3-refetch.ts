import { createTable, type FetchResult } from '@datakable/core'
import { pagination } from '@datakable/core/pagination'
import { withFetcher } from '@datakable/core/server'

type Order = { id: string; total: number }

const table = createTable({
  rowKey: 'id',
  features: [pagination({ mode: 'server' })],
  fetcher: withFetcher(async ({ pageIndex, pageSize, signal }) => {
    const res = await fetch(`/api/orders?page=${pageIndex}&size=${pageSize}`, { signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as FetchResult<Order>
  }),
})

// A failed request keeps the previous rows, sets status 'error' and reports DK_FETCH_FAILED.
// refetch() runs the fetcher again with the current params. It never rejects.
const { status } = await table.refetch()
if (status === 'applied') console.log(table.getRowModel().rows.length, table.getPageCount())
else if (status === 'error') console.log('still failing; the previous rows stay')
// 'superseded': a newer request (or destroy()) replaced this one.
