import { createTable } from '@datakable/core'
import { columnFilters } from '@datakable/core/column-filters'
import { pagination } from '@datakable/core/pagination'

type User = { id: number; name: string; city: string }
declare const users: User[]

const table = createTable({
  data: users,
  rowKey: 'id',
  features: [columnFilters(), pagination({ pageSize: 20, autoResetPageIndex: false })],
  // Takes precedence over pageSize: start on the third page of 50 (e.g. parsed from the URL).
  initialState: { pagination: { pageIndex: 2, pageSize: 50 } },
})

// With autoResetPageIndex: false, a new filter keeps page 2; it is clamped only if the
// filtered rows no longer reach it.
table.setColumnFilter('city', { type: 'equals', value: 'Bangkok' })
console.log(table.getState().pagination.pageIndex)
