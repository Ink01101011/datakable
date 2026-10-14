# A headless table with your own markup

`useDataTable` gives you the table's state and methods, and you write every element yourself.
Use it when `<DataTable />`'s markup does not fit: a design system, cards instead of rows, or a
toolbar of your own.

## Goal

A users table with a search box, a city dropdown filter, sortable headers and a pager, all in your
own JSX, driven by the default preset.

## The code

```tsx
import { useDataTable } from 'datakable/react'

export type User = { id: number; name: string; age: number; city: string }

const COLUMNS = [
  { id: 'name', label: 'Name' },
  { id: 'age', label: 'Age' },
  { id: 'city', label: 'City' },
] as const

const ariaSort = (dir: 'asc' | 'desc' | false) =>
  dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'

export function UsersTable({ users, cities }: { users: User[]; cities: string[] }) {
  // The default preset: column filters, validity, search, sorting and pagination.
  const table = useDataTable({ data: users, rowKey: 'id' })
  const { rows, filteredCount, totalCount } = table.rowModel
  const { pageIndex } = table.state.pagination
  const city = table.state.columnFilters.city

  return (
    <section>
      <input
        type="search"
        aria-label="Search users"
        placeholder="Search"
        value={table.state.search.input}
        onChange={(e) => void table.setSearch(e.target.value)}
      />
      <select
        aria-label="City"
        value={city?.type === 'equals' ? (city.value ?? '') : ''}
        onChange={(e) =>
          table.setColumnFilter(
            'city',
            e.target.value === '' ? undefined : { type: 'equals', value: e.target.value },
          )
        }
      >
        <option value="">All cities</option>
        {cities.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>

      <table>
        <thead>
          <tr>
            {COLUMNS.map(({ id, label }) => (
              <th key={id} aria-sort={ariaSort(table.getSortDirection(id))}>
                {/* Shift+click adds a second sort key. */}
                <button type="button" onClick={(e) => table.toggleSort(id, { multi: e.shiftKey })}>
                  {label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.original.name}</td>
              <td>{row.original.age}</td>
              <td>{row.original.city}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer>
        <button type="button" disabled={!table.canPrevPage()} onClick={table.prevPage}>
          Previous
        </button>
        <span>
          Page {pageIndex + 1} of {Math.max(table.getPageCount(), 1)} · {filteredCount} of{' '}
          {totalCount} users
        </span>
        <button type="button" disabled={!table.canNextPage()} onClick={table.nextPage}>
          Next
        </button>
      </footer>
    </section>
  )
}
```

## What you will see

- The footer reads `Page 1 of 3 · 25 of 25 users` for 25 users: ten rows per page.
- Choosing a city filters the rows and the count (`9 of 25 users`); "All cities" removes the
  filter (`setColumnFilter('city', undefined)`).
- Clicking a header sorts by it and sets `aria-sort` on the `<th>`; Shift+click sorts by a second
  column too.
- Typing in the search box filters as you type, with fuzzy matching; the pager goes back to page 1
  whenever search, filters or sorting change.
- Previous / Next are disabled at the ends (`canPrevPage()` / `canNextPage()`).
- Every call is typed against `User`: `table.toggleSort('nmae')` or a `range` filter on `city`
  does not compile.

## Variations

- **Debounce the search:** pass `features` with
  `search({ typing: { strategy: 'debounce', wait: 300 } })`; the preset is then replaced, so list
  every feature you use ([Async search](async-search.md) shows the list).
- **Show the active sort:** `table.state.sorting.by` is the list of `{ id, desc }` entries, first
  key first.
- **Loading and errors:** with async work (a `fetcher`, a `searchFn`), read `table.rowModel.status`
  and `isInitialLoad` ([Server-side table](server-side-table.md)).
- **Half headless:** build the table with `useDataTable` and render it with
  `<DataTable table={table} />`, keeping your own toolbar.

## See also

- [`@datakable/react`](../../packages/react/README.md#usedatatable) — which options are read once
  and which are synced.
- [Features](../../packages/core/README.md#features) — the state and API of each feature.
- [React](../how-to-use/react.md) — `useDataTable` in depth.
- [A search input](../how-to-use/search.md#a-search-input), [sorting state and
  API](../how-to-use/sorting.md#state-and-api), [pagination state and
  API](../how-to-use/pagination.md#state-and-api) and [column
  filters](../how-to-use/column-filters.md) — the methods this recipe calls.
- [Examples](README.md)
