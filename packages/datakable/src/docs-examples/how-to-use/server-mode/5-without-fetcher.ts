import { createTable } from '@datakable/core'
import { pagination } from '@datakable/core/pagination'
import { sorting } from '@datakable/core/sorting'

type Order = { id: string; total: number }
declare function loadOrders(
  sort: string,
  page: number,
  size: number,
): Promise<{ rows: Order[]; total: number }>

const first = await loadOrders('', 0, 20)

// No fetcher: core holds the server-mode state, and the app fetches and passes each page in.
const table = createTable({
  data: first.rows, // the current page only
  rowCount: first.total, // the total on the server; without it: DK_ROW_COUNT_MISSING
  rowKey: 'id',
  features: [sorting({ mode: 'server' }), pagination({ mode: 'server', pageSize: 20 })],
})

table.subscribe((state, prev) => {
  if (state.sorting === prev.sorting && state.pagination === prev.pagination) return
  const sort = state.sorting.by.map((s) => `${s.desc ? '-' : ''}${s.id}`).join(',')
  const { pageIndex, pageSize } = state.pagination
  void loadOrders(sort, pageIndex, pageSize).then((page) =>
    table.setOptions({ data: page.rows, rowCount: page.total }),
  )
})
