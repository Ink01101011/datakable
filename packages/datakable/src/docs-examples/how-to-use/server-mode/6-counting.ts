import { createTable, type FetchParams, type FetchResult } from '@datakable/core'
import { pagination } from '@datakable/core/pagination'
import { withFetcher } from '@datakable/core/server'

type Order = { id: string; total: number }
declare function fetchOrders(params: FetchParams): Promise<FetchResult<Order>>

// The server's total for "N results": the row model only counts the rows the table holds.
let matching = 0

const table = createTable({
  rowKey: 'id',
  features: [pagination({ mode: 'server', pageSize: 20 })],
  fetcher: withFetcher(async (params: FetchParams) => {
    const result = await fetchOrders(params)
    if (!params.signal.aborted) matching = result.rowCount ?? result.rows.length
    return result
  }),
})

// Once the first page is applied (the fetcher runs at creation):
table.subscribe(() => {
  const { rows, filteredCount, totalCount, status } = table.getRowModel()
  if (status !== 'idle') return
  console.log(rows.length, filteredCount, totalCount) // 20 20 20: the current page
  console.log(matching, table.getPageCount()) // 5000 250: the server's total and its pages
})
