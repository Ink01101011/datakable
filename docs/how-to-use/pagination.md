# Pagination

`pagination()` splits the rows into pages. This page covers the page state and API, what stays on
screen when the page size changes, when the page resets or is clamped, and paging on the server.

## How it works

Install `pagination()` (in the default preset of `datakable`; with `@datakable/core`, import it
from `@datakable/core/pagination`). The `paginate` step runs last: `getRowModel().rows` holds the
current page only, while `filteredCount` counts every row after filters and search.

```ts
import { createTable } from '@datakable/core'
import { pagination } from '@datakable/core/pagination'

type User = { id: number; name: string }
declare const users: User[] // say 45 users

const table = createTable({ data: users, rowKey: 'id', features: [pagination({ pageSize: 20 })] })

const { rows, filteredCount } = table.getRowModel()
console.log(rows.length, filteredCount) // 20 45: rows is the current page only
console.log(table.getPageCount()) // 3

table.nextPage() // page 1 (0-based)
table.setPageIndex(10) // clamped to the last page: 2
console.log(table.canNextPage(), table.canPrevPage()) // false true

table.setPageSize(10) // keeps the first visible row (row 40) on screen: page 4
console.log(table.getState().pagination) // { pageIndex: 4, pageSize: 10 }
```

- **Page size changes keep your place.** `setPageSize` moves to the page that contains the first
  row you were looking at: `floor(firstRow / newSize)`.
- **Auto-reset.** With `autoResetPageIndex` (default `true`), a change of a filter, of the applied
  search `query` or of the sort sends the table back to page 0, in the same update (one
  notification). Typing alone (`state.search.input` changing, `status`) keeps the page. An update
  that sets the `pagination` slice itself keeps the page it sets.
- **Clamping.** When the rows shrink (new data, or filters with auto-reset off), `pageIndex` is
  clamped to the last page. `setPageIndex` clamps too.
- Without `pagination()`, the table is not paged: `rows` holds every row.

## State and API

The `pagination` slice (`PaginationState`) is `{ pageIndex: number; pageSize: number }`;
`pageIndex` is 0-based.

| Method | Description |
| --- | --- |
| `setPageIndex(index)` | Goes to page `index`, clamped to `[0, getPageCount() - 1]`. |
| `setPageSize(size)` | Changes the page size and keeps the first visible row on screen. |
| `nextPage()` | Next page; no-op on the last page. |
| `prevPage()` | Previous page; no-op on the first page. |
| `getPageCount()` | `ceil(rowCount / pageSize)`; `0` when there are no rows. |
| `canNextPage()` | A next page exists. |
| `canPrevPage()` | The current page is not the first. |

A pager built on them (`<DataTable />` renders a default one):

```tsx
import { useDataTable } from 'datakable'

type User = { id: number; name: string }

export function UserPager({ users }: { users: User[] }) {
  const table = useDataTable({ data: users, rowKey: 'id' })
  const { pageIndex, pageSize } = table.state.pagination
  return (
    <nav aria-label="Pagination">
      <button type="button" disabled={!table.canPrevPage()} onClick={table.prevPage}>
        Previous
      </button>
      <span>
        Page {pageIndex + 1} of {Math.max(table.getPageCount(), 1)}
      </span>
      <button type="button" disabled={!table.canNextPage()} onClick={table.nextPage}>
        Next
      </button>
      <select value={pageSize} onChange={(e) => table.setPageSize(Number(e.target.value))}>
        {[10, 20, 50].map((size) => (
          <option key={size} value={size}>
            {size} per page
          </option>
        ))}
      </select>
    </nav>
  )
}
```

## Options

`pagination(options)` (`PaginationOptions`):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `pageSize` | `number` (integer > 0) | `10` | Starting page size. `initialState.pagination` takes precedence. |
| `autoResetPageIndex` | `boolean` | `true` | Go back to page 0 when filters, the search query or the sort change. |
| `mode` | `'client' \| 'server'` | `'client'` | `'server'`: the server pages; the page count comes from `rowCount`. |

Start on a given page (for example from the URL) with `initialState`:

```ts
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
```

## Paging on the server

With `pagination({ mode: 'server' })`, core does not slice the rows: `data` is already the current
page. The page count is `ceil(rowCount / pageSize)`, with `rowCount` from the fetcher result
(`{ rows, rowCount }`), or from the `rowCount` table option when you fetch yourself. Until a
fetcher result arrives, the page count is unknown and nothing is clamped.

```ts
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
```

With a `fetcher`, `pageIndex` and `pageSize` go to it and each page change fetches; see
[Server mode](server-mode.md).

## Pitfalls

- **Invalid values are ignored, not applied.** `setPageIndex(1.5)`, `setPageSize(0)` or a
  `pagination` slice with a non-integer field (from `setState`, `initialState` or controlled
  state) report [DK_INVALID_PAGINATION](../errors.md#dk_invalid_pagination): the call is ignored,
  or the bad field is replaced (`pageIndex` by 0, `pageSize` by the previous valid size).
- **Server paging without a total.** Server-mode pagination with no fetcher and no `rowCount`
  reports [DK_ROW_COUNT_MISSING](../errors.md#dk_row_count_missing) and treats `data.length` as
  the total: one page, `canNextPage()` is `false`. Pass `rowCount`.
- **Counting rows with `rows.length`.** It is the size of the current page; use
  `rowModel.filteredCount` for "N results".
- **The page jumps to 0.** That is `autoResetPageIndex` after a filter, query or sort change; turn
  it off with `pagination({ autoResetPageIndex: false })`.

## See also

- [Features](features.md) — the default preset and pipeline order.
- [Core concepts](core-concepts.md) — the row model and its counts.
- [State](state.md) — `initialState` and controlled slices (e.g. the page in the URL).
- [Server mode](server-mode.md) — `fetcher` and `rowCount`.
- [React](react.md) — `<DataTable />` and `components.Pagination`.
- [`@datakable/core` features](../../packages/core/README.md#features)
- [Examples](../examples/README.md)
