# datakable

Type-safe generic data table for React: zero-config by default, headless when you need it.

This is the batteries-included entry. It re-exports [`@datakable/react`](https://github.com/Ink01101011/datakable/tree/main/packages/react) and
[`@datakable/core`](https://github.com/Ink01101011/datakable/tree/main/packages/core), and its `useDataTable` / `createTable` install the default
preset — `columnFilters()`, `validity()`, `search()`, `sorting()`, `pagination()` — when you pass no
`features`.

> Version 1.0: the public API is stable and follows semantic versioning from here. Guides,
> examples and troubleshooting: the [documentation](https://github.com/Ink01101011/datakable/blob/main/docs/README.md).

## Install

```bash
npm install datakable react
```

React `>=18`. The package is ESM + CJS with types, one file per module: a bundle that uses only
`createTable` contains no React. Only the modules of `<DataTable />` and `useDataTable` are marked
`"use client"`, so `createTable` also works on the server. With the Next.js app router, a server
component can render `<DataTable />` with plain data props; call `useDataTable`, or pass functions
(cells, features, a fetcher), from a client component (a `'use client'` file). In Node.js (SSR,
tests) it needs Node `>=18.18`. The types need TypeScript `>=5.4`.

**Bundler requirement:** DataKable reads `process.env.NODE_ENV` to strip development-only checks
and message text. Vite, webpack, Next.js, Rollup (`@rollup/plugin-replace`) and esbuild
(`--define:process.env.NODE_ENV='"production"'`) replace it; without that replacement, unbundled
browser code throws `ReferenceError: process is not defined`, as React and Redux do.

## React

```tsx
import { useDataTable } from 'datakable'

type User = { id: number; name: string; age: number; city: string }

export function Users({ users }: { users: User[] }) {
  // Zero-config: columns come from the data; sorting, filters, search and pagination are on.
  const table = useDataTable({ data: users, rowKey: 'id' })
  const { rows, filteredCount, status, isInitialLoad } = table.rowModel

  if (status === 'error' && isInitialLoad) return <p>Could not load users.</p>
  return (
    <section data-status={status}>
      <input
        value={table.state.search.input}
        onChange={(e) => void table.setSearch(e.target.value)}
        placeholder="Search"
      />
      <table>
        <thead>
          <tr>
            <th aria-sort={table.getSortDirection('name') === 'desc' ? 'descending' : 'none'}>
              <button type="button" onClick={() => table.toggleSort('name')}>
                Name
              </button>
            </th>
            <th>Age</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.original.name}</td>
              <td>{row.original.age}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>{filteredCount} users</p>
      <button type="button" disabled={!table.canPrevPage()} onClick={table.prevPage}>
        Previous
      </button>
      <button type="button" disabled={!table.canNextPage()} onClick={table.nextPage}>
        Next
      </button>
    </section>
  )
}
```

`useDataTable` returns the table (its methods plus every installed feature's API) with `state` and
`rowModel` for the current render. Everything is typed against the row type: `toggleSort('nmae')`
or `setColumnFilter('name', { type: 'range', … })` do not compile. Passing `features` replaces the
preset entirely, and only the installed features' state and methods exist on the type. `features`
is read once, so hoist the array out of the component with `as const`: a plain array type loses
which features it holds, and the table's type loses their methods (TS2339).

How options are synced, which ones are read once, and why `columns` must be stable:
[`@datakable/react`](https://github.com/Ink01101011/datakable/tree/main/packages/react).

### Controlled state

Own any state slice (for example to sync sorting with the URL); the table owns the rest.

```tsx
import { type SortingState, useDataTable } from 'datakable'
import { useState } from 'react'

type User = { id: number; name: string }

export function Users({ users }: { users: User[] }) {
  // Own one slice (e.g. to sync it with the URL); the store keeps the rest.
  const [sorting, setSorting] = useState<SortingState<User>>({ by: [] })
  const table = useDataTable({
    data: users,
    state: { sorting },
    onStateChange: (updater) => {
      const next = updater({ sorting })
      if (next.sorting) setSorting(next.sorting)
    },
  })
  return (
    <button type="button" onClick={() => table.toggleSort('name')}>
      Sort by name ({table.getSortDirection('name') || 'none'})
    </button>
  )
}
```

## Without React

`createTable` is the same table without React: subscribe to it, or read `getState()` /
`getRowModel()` whenever you need them.

```ts
import { createTable } from 'datakable'

type User = { id: number; name: string; age: number; city: string }

const users: User[] = [
  { id: 1, name: 'Mali', age: 31, city: 'Bangkok' },
  { id: 2, name: 'Anan', age: 25, city: 'Chiang Mai' },
  { id: 3, name: 'Ploy', age: 40, city: 'Bangkok' },
]

// No React needed: the same table, headless. `User` is inferred from `data`.
const table = createTable({ data: users, rowKey: 'id' })

table.toggleSort('age') // asc → desc → none; Shift+click style: toggleSort('age', { multi: true })
table.setColumnFilter('city', { type: 'equals', value: 'Bangkok' })
await table.setSearch('mal') // resolves { status: 'applied' | 'superseded' | 'error' }, never rejects
table.setPageSize(20)

const { rows, filteredCount, totalCount, status } = table.getRowModel()
console.log(
  rows.map((r) => r.original.name),
  filteredCount,
  totalCount,
  status,
)

const unsubscribe = table.subscribe((state) => console.log(state.sorting.by))
unsubscribe()
table.destroy()
```

`datakable/core` re-exports `@datakable/core` unchanged; its `createTable` installs **no** features
unless you pass them (see [Features](https://github.com/Ink01101011/datakable/tree/main/packages/core#features)).

## Loading, empty and error states

`getRowModel()` (`table.rowModel` in React) carries `status` and `isInitialLoad`:

| `status` | Meaning |
| --- | --- |
| `'idle'` | the row model is current |
| `'validating'` | an async schema is running |
| `'pending'` | a search debounce is waiting, time-sliced work (search index, string sort over large data) is running, or async work waits for the client after SSR |
| `'searching'` | an async `searchFn` is in flight |
| `'fetching'` | a `fetcher` request is in flight |
| `'error'` | something affected the row model; the last good rows are still shown |

`isInitialLoad` is `true` until the table has had rows to show once (an empty result counts), and
never goes back. `fetching` + `isInitialLoad` is a full loading state; `fetching` + `!isInitialLoad`
is a refresh over stale rows. A change of either always notifies subscribers — status is never
silent. Details: [status model](https://github.com/Ink01101011/datakable/tree/main/packages/core#status-model).

## Diagnostics in production

Diagnostics (`DK_*` codes with `where`, `impact` and `fix`) print to the console in development.
Production builds keep `code`, `where`, `context` and a docs URL, and strip the text. To keep the
full text in production, import it once in your app entry:

```ts
// In production builds, diagnostics keep code, where, context and a docs URL, but not the text.
// Import once in the app entry to keep the full problem / impact / fix text in production:
import 'datakable/messages'
```

Redaction, `onDiagnostic` (e.g. Sentry), `strict` and `explain()`:
[`@datakable/core` diagnostics](https://github.com/Ink01101011/datakable/tree/main/packages/core#diagnostics).

## DataTable

```tsx
import { DataTable, type DataTableComponents, useDataTable } from 'datakable'

type User = { id: number; name: string; age: number }

// Zero-config: columns come from the data; sort headers (with aria-sort), a search input
// (Enter commits, Esc clears), pagination, and Loading / Empty / Error states. Unstyled: style
// the data-* hooks (data-status, data-initial-load, data-sort, data-invalid, …).
export function AllUsers({ users }: { users: User[] }) {
  return <DataTable data={users} rowKey="id" caption="Users" />
}

// Replace any part; the others stay built in.
const components: DataTableComponents = {
  Empty: ({ filtered }) => <p>{filtered ? 'No user matches.' : 'No users yet.'}</p>,
  Loading: () => <p role="status">Loading users…</p>,
}

// Or render a table you set up yourself (features, controlled state, a fetcher, …).
export function Oldest({ users }: { users: User[] }) {
  const table = useDataTable({
    data: users,
    rowKey: 'id',
    initialState: { sorting: { by: [{ id: 'age', desc: true }] } },
  })
  return <DataTable table={table} components={components} />
}
```

`<DataTable />` takes `useDataTable`'s options (or `table`), plus `components` and `caption`. It
renders what the installed features provide: without `search()` there is no search input, without
`pagination()` no pager. Loading shows while the first rows are on their way (`isInitialLoad` with
`fetching` / `searching` / `validating`, or `pending` for async work deferred by SSR), Error when
the first load failed (with a retry), Empty once loaded with zero rows, and a refresh indicator
over stale rows otherwise. Rows flagged by a schema (`invalidRows: 'flag'`) get
`data-invalid` / `aria-invalid`. A `cell` / `format` that throws renders `⚠` in that cell
(`DK_CALLBACK_FAILED`), and so does a component returned by `cell` that throws while rendering
(`DK_RENDER_FAILED`, per-cell error boundary; the other cells keep rendering). A component that
throws elsewhere in the body shows the Error state with a retry instead of unmounting the page.

For a default look, import `datakable/styles.css` once (e.g. `import 'datakable/styles.css'` in
your app entry). It styles only those hooks, every rule has zero specificity (`:where()`), so
your own CSS always wins, and it themes through `--dk-*` custom properties (`--dk-accent`,
`--dk-border`, `--dk-danger`, …) with a dark set under `prefers-color-scheme: dark`. Without that
import, DataKable adds no CSS at all.

## SSR

```tsx
import {
  DataTable,
  type FetchParams,
  type FetchResult,
  pagination,
  sorting,
  withFetcher,
} from 'datakable'

type User = { id: number; name: string }

async function fetchUsers({ sort, pageIndex, pageSize, signal }: FetchParams) {
  const order = (sort ?? []).map((s) => `${s.desc ? '-' : ''}${s.id}`).join(',')
  const res = await fetch(`/api/users?sort=${order}&page=${pageIndex}&size=${pageSize}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as FetchResult<User> // { rows, rowCount }
}

// Read once, at creation: define features outside the component. `as const` keeps the tuple
// type, so a `useDataTable` result would keep each feature's methods (here <DataTable /> needs none).
const features = [
  sorting({ mode: 'server' }),
  pagination({ mode: 'server', pageSize: 20 }),
] as const

// Rendered on the server, then hydrated. `firstPage` / `rowCount` were fetched on the server
// for the same initial state (e.g. parsed from the URL and passed as `initialState`).
export function Users({ firstPage, rowCount }: { firstPage: User[]; rowCount: number }) {
  return (
    <DataTable
      rowKey="id"
      features={features}
      fetcher={withFetcher(fetchUsers)}
      // The server HTML shows these rows and hydration does not fetch them again. Without
      // initialData nothing is fetched on the server: the HTML shows Loading (status 'pending',
      // DK_SSR_ASYNC_DEFERRED) and the browser fetches right after hydrating.
      initialData={firstPage}
      rowCount={rowCount}
    />
  )
}
```

- Rendering starts no async work: the fetcher's first request and a `searchFn` for an initial
  query run after hydration, unless `initialData` already holds their result.
- `initialState` (e.g. `?q=ada&sort=-age` parsed from the URL) applies on the server: client-mode
  features filter, search and sort the HTML.
- The hydrated client renders the same snapshot as the server; a table that changed before the
  hydration commit reports `DK_HYDRATION_MISMATCH`, naming the slices. Time-sliced work never runs
  on the server or for the first row model, so it cannot cause a mismatch.

Without React, `createDeferred` / `startTable` give your own bindings the same behaviour:

```ts
import {
  createDeferred,
  createTable,
  type FetchResult,
  sorting,
  startTable,
  withFetcher,
} from 'datakable'

type User = { id: number; name: string }

// For your own bindings (useDataTable does this for you): a table created inside
// createDeferred starts no async work — no fetcher request, no searchFn call, no timer.
const table = createDeferred(() =>
  createTable({
    rowKey: 'id',
    features: [sorting({ mode: 'server' })],
    fetcher: withFetcher(
      async ({ signal }) =>
        (await (await fetch('/api/users', { signal })).json()) as FetchResult<User>,
    ),
  }),
)

// On the server: render from the row model as it is (status 'pending', no rows yet).
console.log(table.getRowModel().status) // 'pending'

// In the browser, once the server HTML is hydrated: the deferred request starts.
startTable(table)
```

## Entry points

| Import | What |
| --- | --- |
| `datakable` | `useDataTable` and `createTable` with the default preset, plus everything from `@datakable/react` and `@datakable/core` |
| `datakable/core` | `@datakable/core` as is (no preset by default) |
| `datakable/messages` | side-effect import: full diagnostic text in production |
| `datakable/styles.css` | optional stylesheet for `<DataTable />` (~1 kB gzip) |

## License

MIT
