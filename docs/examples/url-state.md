# Keep the table's state in the URL

Users expect to share or reload a filtered, sorted page and land on the same view. Here the URL
owns the search query, the sort and the page: the table starts from the query string and writes
every change back to it.

## Goal

Read `?q=ada&sort=-age&page=2` into the table on load, and update the query string whenever the
user searches, sorts or pages.

## The code

```tsx
import { type PaginationState, type SearchState, type SortingState, useDataTable } from 'datakable'
import { useEffect, useState } from 'react'

export type User = { id: number; name: string; age: number }

// The slices the URL owns. `?q=ada&sort=-age&page=2` ⇄ search, sorting and pagination.
type UrlState = {
  search: SearchState
  sorting: SortingState<User>
  pagination: PaginationState
}

const SORTABLE = ['name', 'age'] as const

export function readUrl(query: string, pageSize = 20): UrlState {
  const params = new URLSearchParams(query)
  const q = params.get('q') ?? ''
  const sort = params.get('sort') ?? ''
  const id = SORTABLE.find((c) => c === sort.replace(/^-/, ''))
  const page = Number(params.get('page'))
  return {
    search: { input: q, query: q, status: 'idle' },
    sorting: { by: id ? [{ id, desc: sort.startsWith('-') }] : [] },
    pagination: { pageIndex: Number.isInteger(page) && page > 1 ? page - 1 : 0, pageSize },
  }
}

export function writeUrl({ search, sorting, pagination }: UrlState): string {
  const params = new URLSearchParams()
  if (search.query) params.set('q', search.query)
  const [first] = sorting.by
  if (first) params.set('sort', `${first.desc ? '-' : ''}${first.id}`)
  if (pagination.pageIndex > 0) params.set('page', String(pagination.pageIndex + 1))
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function UsersTable({ users }: { users: User[] }) {
  // Controlled slices: the component owns them, the table reports every change.
  const [state, setState] = useState(() => readUrl(window.location.search))
  const table = useDataTable({
    data: users,
    rowKey: 'id',
    state,
    onStateChange: (updater) => setState((prev) => ({ ...prev, ...updater(prev) })),
  })

  // State → URL. replaceState: typing or paging does not flood the back button.
  useEffect(() => {
    const next = writeUrl(state)
    if (next !== window.location.search) {
      window.history.replaceState(null, '', `${window.location.pathname}${next}`)
    }
  }, [state])

  return (
    <section>
      <input
        type="search"
        aria-label="Search users"
        value={table.state.search.input}
        onChange={(e) => void table.setSearch(e.target.value)}
      />
      <button type="button" onClick={() => table.toggleSort('age')}>
        Sort by age ({table.getSortDirection('age') || 'none'})
      </button>
      <ol>
        {table.rowModel.rows.map((row) => (
          <li key={row.key}>
            {row.original.name} ({row.original.age})
          </li>
        ))}
      </ol>
      <button type="button" disabled={!table.canNextPage()} onClick={table.nextPage}>
        Next page
      </button>
    </section>
  )
}
```

## What you will see

- Opening `/users?sort=-age&page=2` shows the second page of users, oldest first, and the button
  reads "Sort by age (desc)".
- Every change updates the query string in place (`history.replaceState`): typing `ada` gives
  `?q=ada`, the next page `?q=ada&page=2`. Sorting or searching goes back to page 1, so `page`
  disappears; with no search, sort or page, the query string is empty.
- Values that do not belong in the URL are ignored on the way in: an unknown `sort` column means
  no sort, and a page below 1 is page 1.
- Only the three controlled slices go through your state; column filters and validity stay
  inside the table.

## Variations

- **A router:** read the query with your router (`useSearchParams` in Next.js or React Router) and
  write it with its `replace` / `navigate({ replace: true })` instead of `window.history`.
- **Back button history:** use `pushState` for sort and page changes, `replaceState` for typing.
- **Only one slice:** control just `sorting`, and use `initialState` for the rest (the
  [controlled state example](../../packages/datakable/README.md#controlled-state)).
- **Server rendering:** parse the same query on the server and pass it as `initialState`; client
  features filter, search and sort the server HTML ([Next.js](nextjs-ssr.md)).
- **Server data:** with a `fetcher`, the same controlled slices drive the requests
  ([Server-side table](server-side-table.md)).

## See also

- [Controlled state](../../packages/datakable/README.md#controlled-state) in `datakable`.
- [`@datakable/react`](../../packages/react/README.md#usedatatable) — `state` and
  `onStateChange` are synced on every render.
- [Controlled state](../how-to-use/state.md#controlled-state) — the guide.
- [Sorting or filtering does nothing](../how-to-fix/sorting-or-filtering-does-nothing.md) — when a
  controlled slice is not fed back.
- [Examples](README.md)
