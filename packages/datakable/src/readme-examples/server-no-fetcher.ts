import { createTable } from '@datakable/core'
import { pagination } from '@datakable/core/pagination'

type User = { id: number; name: string }
declare const page: User[] // the rows of the current page, fetched by the app
declare const total: number

// Server mode without a fetcher: core only holds the state; the app fetches.
const table = createTable({
  data: page,
  rowCount: total, // without it: DK_ROW_COUNT_MISSING
  features: [pagination({ mode: 'server' })],
})

table.subscribe((state) => {
  // fetch page state.pagination.pageIndex, then:
  // table.setOptions({ data: nextPage, rowCount: nextTotal })
  console.log(state.pagination)
})
