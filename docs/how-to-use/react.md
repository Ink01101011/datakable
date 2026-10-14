# React

This page is for using DataKable in React: the `useDataTable` hook for your own markup, the
`<DataTable />` component that renders a complete table, how options reach the table across
renders, replacing parts of `<DataTable />`, and styling it.

## Which package

| Import from | `useDataTable` / `<DataTable />` with no `features` | `"use client"` |
| --- | --- | --- |
| `datakable` | install the default preset: `columnFilters`, `validity`, `search`, `sorting`, `pagination` | on the `useDataTable` and `<DataTable />` modules only (`createTable` also runs on the server) |
| `@datakable/react` | install **no** features | on the `useDataTable` and `<DataTable />` modules only |

Both take the same options and return the same types; passing `features` replaces the preset
entirely. Most apps import from `datakable`. With the Next.js app router, a server component can
render `<DataTable />` with plain data props; call `useDataTable`, or pass functions (cell
components, features, a fetcher), from a client component (a file starting with `'use client'`):

```tsx
'use client'
// app/users/users-table.tsx — a client component of the Next.js app router. Only the modules of
// <DataTable /> and useDataTable are "use client" (createTable also runs on the server); call the
// hook, or pass functions such as cell components, features or a fetcher, from a file like this.
import { DataTable } from 'datakable'

type User = { id: number; name: string }

export function UsersTable({ users }: { users: User[] }) {
  return <DataTable data={users} rowKey="id" />
}
```

## `useDataTable`

`useDataTable(options)` takes [`createTable`'s options](core-concepts.md), with `cell` and
`invalidCell` returning a `ReactNode`, and returns the table — its methods plus the installed
features' APIs — with two more fields for the current render:

| Field | Type | |
| --- | --- | --- |
| `state` | the table's state type | `getState()` for this render |
| `rowModel` | `RowModel<T>` | `getRowModel()` for this render: `rows`, `filteredCount`, `totalCount`, `status`, `isInitialLoad` |

The returned object is new whenever the table notifies and the same object otherwise, so it works
as a `useMemo` dependency or a prop of a `memo` child.

```tsx
import { type ColumnDef, useDataTable } from 'datakable'
import type { ReactNode } from 'react'

type User = { id: number; name: string; email: string; age: number }

// Compared by reference: define columns outside the component (or memoise them).
const columns: ColumnDef<User, ReactNode>[] = [
  { key: 'name', header: 'Name', cell: ({ value }) => <strong>{value}</strong> },
  { key: 'email', header: 'Email' },
  { key: 'age', header: 'Age' },
]

export function Users({ users }: { users: User[] }) {
  // `datakable`: the default preset (filters, validity, search, sorting, pagination).
  const table = useDataTable({ data: users, rowKey: 'id', columns })
  const { rows, filteredCount } = table.rowModel

  return (
    <>
      <input
        value={table.state.search.input}
        onChange={(e) => void table.setSearch(e.target.value)}
        aria-label="Search users"
      />
      <ul>
        {rows.map((row) => (
          <li key={row.key}>
            {row.original.name} ({row.original.age})
          </li>
        ))}
      </ul>
      <p>
        {filteredCount} users · page {table.state.pagination.pageIndex + 1} of{' '}
        {table.getPageCount()}
      </p>
    </>
  )
}
```

- The table is created once per component instance, on the first render, and destroyed on
  unmount. Renders read it through `useSyncExternalStore`.
- Everything is typed against the row type and the installed features: `toggleSort('nmae')` does
  not compile, and neither does `setSearch` when `search()` is not installed.
- A hoisted `features` array needs `as const`. `features` is read once, so define it outside the
  component; without `as const` its type is a plain array, and the table's type loses the
  features' methods and state.

```tsx
import { pagination, sorting } from '@datakable/core'
import { useDataTable } from '@datakable/react'

type User = { id: number; name: string }

// `features` is read once, at creation. Hoist the array with `as const`: a plain array type
// loses which features it holds, and with it their methods and state on the table's type.
const features = [sorting(), pagination({ pageSize: 20 })] as const

export function Users({ users }: { users: User[] }) {
  // @datakable/react installs only the features you pass.
  const table = useDataTable({ data: users, rowKey: 'id', features })
  return (
    <button type="button" onClick={() => table.toggleSort('name')}>
      Name {table.getSortDirection('name') || ''}
    </button>
  )
}
```

### Options: read once and synced

| Kind | Options | What happens when the value changes |
| --- | --- | --- |
| Read once, at creation | `features`, `schema`, `invalidRows`, `initialState`, `initialData`, `name`, `timeout`, `strict`, `diagnostics` | nothing: a new inline `features` array never recreates the table |
| Synced | `data`, `columns`, `rowKey`, `state`, `onStateChange`, `interceptors`, `onDiagnostic`, `fetcher`, `rowCount` | forwarded with one `table.setOptions(...)` in a layout effect, never during render |

How synced values are compared:

- `data`, `columns` and a `rowKey` function are compared **by reference**. A new array tells the
  table the data or columns changed. Define columns outside the component or memoise them, and
  memoise derived data. Structural comparison is not used, because a changed `format` or
  `accessor` would then go stale silently.
- `state` is compared slice by slice and `interceptors` item by item, so an inline object or array
  of the same values is not a change.
- `fetcher`, `onStateChange` and `onDiagnostic` go to the table as stable wrappers that call the
  latest prop. A new reference never refetches; call `table.refetch()` when a value your fetcher
  reads changes.

In development, a value recreated on every render is reported after two renders in a row:
`DK_UNSTABLE_COLUMNS` for `columns` of the same shape, `DK_UNSTABLE_OPTION` for `data` with equal
rows, a `fetcher` or `rowKey` function, or a function option of a feature (`features[i].searchFn`).
Inline `onStateChange` and `onDiagnostic` are fine.

### Controlled state

Pass `state` with the slices you own and `onStateChange` to receive their changes. The updater
merges only the changed controlled slices into the value you give it. Slices you do not pass stay
with the table. Details: [State](state.md).

```tsx
import { type PaginationState, useDataTable } from 'datakable'
import { useState } from 'react'

type User = { id: number; name: string }

export function Users({ users }: { users: User[] }) {
  // Own the pagination slice (e.g. to keep it in the URL); the table owns the other slices.
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 })
  const table = useDataTable({
    data: users,
    rowKey: 'id',
    state: { pagination },
    // Receives an updater over the controlled slices that changed.
    onStateChange: (updater) => {
      const next = updater({ pagination })
      if (next.pagination) setPagination(next.pagination)
    },
  })
  return (
    <button type="button" disabled={!table.canNextPage()} onClick={table.nextPage}>
      Page {pagination.pageIndex + 2}
    </button>
  )
}
```

### Status-driven UI

Render loading, error and refresh states from `table.rowModel.status` and `isInitialLoad`; the
model is in [Core concepts](core-concepts.md), and a fetcher example in
[Server mode](server-mode.md#statuses-loading-refreshing-failing).

## `<DataTable />`

`<DataTable />` renders a complete, accessible, unstyled table. It takes either `table` (the value
`useDataTable` returns, for a table you set up yourself) or `useDataTable`'s options as props
(zero-config: columns derived from the data), plus its own props:

| Prop | Type | |
| --- | --- | --- |
| `table` | `DataTableSource` | a `useDataTable` result to render as is (option props are then ignored) |
| `components` | `DataTableComponents` | replaces the search input, pager or states (below) |
| `caption` | `ReactNode` | rendered as the table's `<caption>` |
| …options | `UseDataTableOptions` | `data`, `rowKey`, `columns`, `features`, `fetcher`, … (with no `table`) |

```tsx
import { DataTable } from 'datakable'

type User = { id: number; name: string; age: number }

// Columns derived from the data, the default preset, a caption. Unstyled until you style the
// data-* hooks or add the optional stylesheet (datakable/styles.css) once in your app entry.
export function Users({ users }: { users: User[] }) {
  return <DataTable data={users} rowKey="id" caption="Users" />
}
```

It renders what the installed features provide:

- **Headers** from the columns' `header` (else the column id). With `sorting()`, each header is a
  button that calls `toggleSort(id)` (Shift+click: `{ multi: true }`), with `aria-sort` and
  `data-sort`; a column with `sortable: false` gets a plain header.
- **A search input** with `search()`, bound to `state.search.input`: typing calls `setSearch`,
  Enter `flushSearch`, Esc `clearSearch`, and a spinner shows while the search is `pending` or
  `searching`.
- **A pager** with `pagination()`: previous / next buttons and "Page n of m".
- **Cells** through the column's `cell`, else `format`, else the default formatter; flagged cells
  (`invalidRows: 'flag'`) through `invalidCell`, else the raw value with a `⚠` marker.

### Loading, error, empty and refreshing

The body shows one state at a time, from `status` and `isInitialLoad`:

| State | When | Component |
| --- | --- | --- |
| Loading | `isInitialLoad` and `status` is `'fetching'`, `'searching'` or `'validating'`; or `'pending'` while the table has a `fetcher` or `searchFn` with nothing applied yet (deferred until the client, see [SSR](ssr.md)) | `Loading` |
| Error | `isInitialLoad` and `status === 'error'`: the first load failed | `Error` with `reason: 'load'`; `retry` calls `refetch()` |
| Empty | loaded, zero rows to show | `Empty`; `filtered` is `true` when there is data but filters or search removed every row |
| Rows | otherwise | — |

Over loaded rows, any `status` other than `'idle'` shows a refresh indicator above the table:
"Updating…" while busy, or "Could not refresh; showing the previous rows." with a retry on
`'error'`.

### Replacing parts with `components`

Each part you pass replaces the built-in one; the others stay. Hoist the object so it is the same
on every render.

```tsx
import {
  DataTable,
  type DataTableComponents,
  type ErrorProps,
  type PaginationProps,
  type SearchInputProps,
} from 'datakable'

function Search({ value, status, onChange, onSubmit, onClear }: SearchInputProps) {
  return (
    <input
      type="search"
      placeholder="Search users"
      value={value}
      aria-busy={status === 'pending' || status === 'searching'}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSubmit()
        if (e.key === 'Escape') onClear()
      }}
    />
  )
}

function Pager({ pageIndex, pageCount, canPrev, canNext, prev, next }: PaginationProps) {
  return (
    <nav aria-label="Pages">
      <button type="button" disabled={!canPrev} onClick={prev}>
        Previous
      </button>
      {pageIndex + 1} / {Math.max(pageCount, 1)}
      <button type="button" disabled={!canNext} onClick={next}>
        Next
      </button>
    </nav>
  )
}

function Failed({ reason, retry }: ErrorProps) {
  return (
    <p role="alert">
      {reason === 'load' ? 'Could not load users.' : 'Could not show users.'}{' '}
      <button type="button" onClick={retry}>
        Try again
      </button>
    </p>
  )
}

// Hoisted: one object for every render. Parts you leave out stay built in.
const components: DataTableComponents = {
  SearchInput: Search,
  Pagination: Pager,
  Empty: ({ filtered }) => <p>{filtered ? 'No user matches.' : 'No users yet.'}</p>,
  Loading: () => <p role="status">Loading users…</p>,
  Error: Failed,
}

type User = { id: number; name: string }

export function Users({ users }: { users: User[] }) {
  return <DataTable data={users} rowKey="id" components={components} />
}
```

| Component | Props |
| --- | --- |
| `SearchInput` | `SearchInputProps`: `value` (`state.search.input`), `status` (`'idle' \| 'pending' \| 'searching' \| 'error'`), `onChange(value)` (`setSearch`), `onSubmit()` (`flushSearch`), `onClear()` (`clearSearch`) |
| `Pagination` | `PaginationProps`: `pageIndex`, `pageSize`, `pageCount`, `canPrev`, `canNext`, `prev()`, `next()`, `setPageIndex(index)`, `setPageSize(size)` |
| `Empty` | `EmptyProps`: `filtered` |
| `Loading` | `LoadingProps`: `status` |
| `Error` | `ErrorProps`: `status`, `reason` (`'load'` \| `'render'`), `retry()` (`'load'`: `refetch()`; `'render'`: renders the body again) |

### When a cell or a part throws

`<DataTable />` contains failures to the smallest part it can:

- A `cell`, `format` or `invalidCell` that throws renders `⚠` in that cell and reports
  `DK_CALLBACK_FAILED` (one diagnostic per column, with the failed rows). Every `⚠` below is an
  image named "Could not display this value" for screen readers.
- A `cell` that returns a promise renders `⚠`, and a `format` that returns a non-string falls back
  to the default formatter; both report `DK_CALLBACK_BAD_RETURN` in development.
- A component returned by `cell` that throws while React renders it renders `⚠` in that cell only
  (each such cell has its own error boundary) and reports `DK_RENDER_FAILED`. The cell renders
  again when its row or column changes.
- A component that throws elsewhere in the body (`Empty`, `Loading`, `Error`) shows the Error
  state with `reason: 'render'` and a retry; the header, search and pager keep working.
- A `SearchInput` or `Pagination` component that throws is replaced by the default part (still
  bound to the table) until another component is passed, and reports `DK_RENDER_FAILED` at
  `components.SearchInput` / `components.Pagination`.

## Styling

`<DataTable />` ships no CSS. Style it through the attributes it renders:

| Hook | On | Values |
| --- | --- | --- |
| `data-datakable` | the root `<div>` | — |
| `data-status` | the root, the search wrapper, the refresh indicator | the row model `status` (the search wrapper: the search `status`) |
| `data-initial-load` | the root | `'true'` / `'false'` |
| `aria-busy` | the root | `'true'` while `validating`, `pending`, `searching` or `fetching` |
| `data-dk-search` | the search input's wrapper | — |
| `data-dk-spinner` | the search spinner (`role="status"`) | — |
| `aria-sort`, `data-sort` | sortable `<th>` | `ascending` / `descending` / `none`; `asc` / `desc` |
| `data-dk-sort-indicator` | the ▲ / ▼ in a sort button | — |
| `data-dk-state` | the state row `<tr>` | `loading`, `error`, `empty` |
| `data-invalid`, `aria-invalid` | flagged rows and their cells with issues | `'true'` |
| `data-dk-invalid-marker` | the `⚠` of an invalid cell | — |
| `data-dk-pagination`, `data-dk-page` | the pager `<nav>` and its "Page n of m" | — |
| `data-dk-refresh` | the refresh indicator | — |

For a default look, import `datakable/styles.css` (or `@datakable/react/styles.css`) once, in your
app entry: `import 'datakable/styles.css'`. It styles only these hooks; every selector sits in
`:where()`, so it has zero specificity and any rule of yours wins. Theme it with custom properties
on `[data-datakable]`: `--dk-font-size`, `--dk-fg`, `--dk-muted`, `--dk-bg`, `--dk-subtle`,
`--dk-border`, `--dk-accent`, `--dk-danger`, `--dk-danger-bg`, `--dk-radius`, `--dk-cell-py`,
`--dk-cell-px`. A dark set applies under `prefers-color-scheme: dark`.

```css
[data-datakable] {
  --dk-accent: #7c3aed;
  --dk-radius: 0;
}
```

## Pitfalls

- **Columns defined inline in the component** are a new array on every render:
  [`DK_UNSTABLE_COLUMNS`](../how-to-fix/errors.md#dk_unstable_columns). Hoist or `useMemo` them.
- **A new `data` array, `rowKey` function or `fetcher` on every render**:
  [`DK_UNSTABLE_OPTION`](../how-to-fix/errors.md#dk_unstable_option). Memoise them; for a fetcher, hoist
  `withFetcher(fetchUsers)` or wrap a `useCallback`.
- **Changing `features`, `schema`, `initialState` and the other read-once options** after the first
  render has no effect; remount the component (a new `key`) to start over.
- **Controlled `state` without `onStateChange`** freezes those slices:
  [`DK_CONTROLLED_WITHOUT_HANDLER`](../how-to-fix/errors.md#dk_controlled_without_handler).
- **An `onStateChange` that does not set the state you pass back** freezes them too:
  [`DK_CONTROLLED_NOT_FED_BACK`](../how-to-fix/errors.md#dk_controlled_not_fed_back) (development).
- **A cell that throws** renders `⚠`: [`DK_CALLBACK_FAILED`](../how-to-fix/errors.md#dk_callback_failed); a
  component inside a cell that throws: [`DK_RENDER_FAILED`](../how-to-fix/errors.md#dk_render_failed).
- **`format` returning a number** or `cell` returning a promise:
  [`DK_CALLBACK_BAD_RETURN`](../how-to-fix/errors.md#dk_callback_bad_return).
- **`process is not defined` in the browser:** your bundler does not replace
  `process.env.NODE_ENV`; see [Getting started](getting-started.md).

## See also

- [Server rendering (SSR)](ssr.md) — `useDataTable` and `<DataTable />` on the server.
- [State](state.md) — controlled slices.
- [Columns and row keys](columns-and-row-keys.md) — `cell`, `format` and `invalidCell`.
- [Server mode](server-mode.md) — a fetcher with `useDataTable`.
- [`@datakable/react` README](../../packages/react/README.md#usedatatable)
- [`datakable` README](../../packages/datakable/README.md) — `<DataTable />` and controlled state.
- [A headless table](../examples/headless-table.md) and [theming](../examples/theming.md) — recipes.
- [Endless re-renders or a frozen page](../how-to-fix/endless-re-renders.md) — troubleshooting.
- [Examples](../examples/README.md)
