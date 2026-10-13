import { createTable } from '@datakable/core'
import { pagination } from '@datakable/core/pagination'

type User = { id: number; name: string }
declare function loadPage(index: number, size: number): Promise<{ rows: User[]; total: number }>

const first = await loadPage(0, 25)

// Server paging without a fetcher: data is the current page, rowCount the server total.
const table = createTable({
  data: first.rows,
  rowCount: first.total, // without it: DK_ROW_COUNT_MISSING, and data.length counts as the total
  rowKey: 'id',
  features: [pagination({ mode: 'server', pageSize: 25 })],
})

table.subscribe((state, prev) => {
  const { pageIndex, pageSize } = state.pagination
  if (pageIndex === prev.pagination.pageIndex && pageSize === prev.pagination.pageSize) return
  void loadPage(pageIndex, pageSize).then(({ rows, total }) =>
    table.setOptions({ data: rows, rowCount: total }),
  )
})

table.nextPage() // page count = ceil(rowCount / pageSize)
