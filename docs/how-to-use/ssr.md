# Server rendering (SSR)

This page is for rendering a table on the server — Next.js, Remix, `renderToString` — and
hydrating it in the browser without a flash or a second fetch. It covers what runs during the
server render, starting state from the URL with `initialState`, server-fetched rows with
`initialData`, how async work is deferred to the client, hydration checks, and the
`createDeferred` / `startTable` seam for your own bindings.

## What runs on the server

`useDataTable` and `<DataTable />` render on the server like any component:

- **Synchronous work runs.** Data is ingested (and validated by a synchronous schema),
  `initialState` applies, and client-mode features filter, search, sort and page the rows: the
  HTML shows the same rows the browser will.
- **No async work starts.** The fetcher's first request and a `searchFn` for an initial query do
  not run during the render, and no timer is left behind. Until they start, the row model has
  `status: 'pending'`, and on the server each deferred source reports `DK_SSR_ASYNC_DEFERRED`
  (info). `<DataTable />` renders its Loading state for it, so the HTML is not an empty table.
  After hydration, the work starts in a layout effect.
- **Time-sliced work never runs** on the server or for the first row model (building a search
  index, ranking strings for a large sort), so it cannot make the two renders differ.

## Starting state from the URL

`initialState` gives the starting value of any slice — for example parsed from the query string.
It is read once, at creation, on the server and in the browser alike, so both start from the same
state. Pass it to `useDataTable` or as a `<DataTable />` prop.

```tsx
import { type SortEntry, useDataTable } from 'datakable'

type User = { id: number; name: string; age: number }

/** `?q=ada&sort=-age&page=2` → the table's starting state, the same on the server and client. */
function stateFromUrl(params: URLSearchParams) {
  const q = params.get('q') ?? ''
  const sort = params.get('sort')
  const by: SortEntry<User>[] =
    sort === 'age' || sort === '-age' ? [{ id: 'age', desc: sort.startsWith('-') }] : []
  return {
    search: { input: q, query: q, status: 'idle' as const },
    sorting: { by },
    pagination: { pageIndex: Math.max(0, Number(params.get('page') ?? 1) - 1), pageSize: 20 },
  }
}

export function Users({ users, search }: { users: User[]; search: string }) {
  // Read once, at creation. Client-mode features apply it while rendering on the server, so the
  // HTML is already searched, sorted and on the right page.
  const table = useDataTable({
    data: users,
    rowKey: 'id',
    initialState: stateFromUrl(new URLSearchParams(search)),
  })
  return (
    <ul>
      {table.rowModel.rows.map((row) => (
        <li key={row.key}>{row.original.name}</li>
      ))}
    </ul>
  )
}
```

Typed slices (with the `datakable` preset): `search` is `{ input, query, status }`, `sorting`
`{ by: { id, desc }[] }`, `pagination` `{ pageIndex, pageSize }`, `columnFilters` one filter per
column, `validity` `'all' | 'valid' | 'invalid'`. A slice given in `initialState` replaces the
feature's own starting value. See [State](state.md).

## Server-fetched rows with `initialData`

With a fetcher, the server render has no rows: the request is deferred to the client. To put rows
in the HTML, fetch them on the server for the same initial state and pass them as `initialData`:

- `initialData` is ingested at creation like `data` (validated by a `schema` too), and counts as
  the result of the initial async work: the fetcher's first request is skipped, a `searchFn` is not
  called for the initial query, and hydration does not fetch again. A later change of the
  server-mode state (a page, a sort) fetches as usual.
- With server-mode pagination, pass the server's total as `rowCount` (without it, the total is
  `initialData.length`). Once a fetch applies, the count comes from the fetcher result.
- It is read once, at creation, and used only without `data`: with both, `data` wins and
  `initialData` is reported as `DK_OPTION_NO_EFFECT`.

With the Next.js app router, a server component fetches the first page and hands it to a client
component:

```tsx
'use client'
// app/users/users-table.tsx
import {
  DataTable,
  type FetchParams,
  type FetchResult,
  pagination,
  sorting,
  withFetcher,
} from 'datakable'

export type User = { id: number; name: string }

async function fetchUsers({ sort, pageIndex, pageSize, signal }: FetchParams) {
  const order = (sort ?? []).map((s) => `${s.desc ? '-' : ''}${s.id}`).join(',')
  const res = await fetch(`/api/users?sort=${order}&page=${pageIndex}&size=${pageSize}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as FetchResult<User>
}

const features = [sorting({ mode: 'server' }), pagination({ mode: 'server', pageSize: 20 })]
const fetcher = withFetcher(fetchUsers)

export function UsersTable({ firstPage, rowCount }: { firstPage: User[]; rowCount: number }) {
  // initialData answers the first request: the server HTML shows these rows, and hydration does
  // not fetch them again. Sorting or paging later fetches as usual.
  return (
    <DataTable
      rowKey="id"
      features={features}
      fetcher={fetcher}
      initialData={firstPage}
      rowCount={rowCount}
    />
  )
}
```

```tsx
// app/users/page.tsx — a server component: it fetches the first page for the initial state
// (page 0, unsorted, 20 rows), and the client component renders and hydrates it. The fetch runs
// inside <Suspense>, as Next 16's cacheComponents requires for uncached data.
import { Suspense } from 'react'
import { type User, UsersTable } from './2-users-table'

declare function queryUsers(opts: {
  page: number
  size: number
}): Promise<{ rows: User[]; total: number }>

export default function Page() {
  return (
    <Suspense fallback={<p>Loading users…</p>}>
      <FirstPage />
    </Suspense>
  )
}

async function FirstPage() {
  const { rows, total } = await queryUsers({ page: 0, size: 20 })
  return <UsersTable firstPage={rows} rowCount={total} />
}
```

The server component must fetch the rows the client table's initial state asks for (here page 0,
unsorted, 20 rows); otherwise the first rows the user sees do not match the controls.

## Hydration

`useDataTable` hydrates from the snapshot the table had at creation (`getServerSnapshot`): initial
state, controlled state and `data` / `initialData`, before any async result. As long as the props
are the same on both sides, the hydrated client renders exactly the server HTML.

A table that changed between creation and the hydration commit — different `data`, a state change
before React committed — reports `DK_HYDRATION_MISMATCH`, naming the slices that differ (or `rows`
when only the rows did). React then re-renders on the client.

## Your own bindings: `createDeferred` and `startTable`

Without React, the same behaviour is two functions from `@datakable/core` (also exported by
`datakable`):

| Function | |
| --- | --- |
| `createDeferred(create)` | runs `create` (a `createTable` call) so that the table it creates starts no async work; returns the table. On the server (no `document`), reports `DK_SSR_ASYNC_DEFERRED` for each deferred source |
| `startTable(table)` | starts the deferred work: the fetcher's first request (unless `initialData` answered it) and the `searchFn` for the applied query. Idempotent; a no-op for a table that was not deferred or is destroyed |

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

// For your own bindings (useDataTable does this for you): a table created inside createDeferred
// starts no async work — no fetcher request, no searchFn call, no timer.
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

// On the server: render from the row model as it is. Its status is 'pending' (nothing fetched
// yet), and DK_SSR_ASYNC_DEFERRED (info) says why.
const { status, isInitialLoad } = table.getRowModel()
console.log(status, isInitialLoad) // 'pending' true

// In the browser, once the server HTML is hydrated: the deferred request starts. Idempotent.
startTable(table)
```

`useDataTable` creates its table this way and calls `startTable` after the commit.

## Pitfalls

- **The server HTML shows Loading** with a fetcher: that is
  [`DK_SSR_ASYNC_DEFERRED`](../how-to-fix/errors.md#dk_ssr_async_deferred). Fetch on the server and pass
  `initialData` (and `rowCount`) to render rows.
- **The server and client render different data or state**:
  [`DK_HYDRATION_MISMATCH`](../how-to-fix/errors.md#dk_hydration_mismatch). Pass the same props on both sides
  (serialize the server's rows, parse the same URL), and do not change the table before hydration.
- **`initialData` together with `data`**: `initialData` is ignored
  ([`DK_OPTION_NO_EFFECT`](../how-to-fix/errors.md#dk_option_no_effect)).
- **`initialState` naming a column that does not exist** (an old URL): the filter is ignored with
  [`DK_STATE_UNKNOWN_KEY`](../how-to-fix/errors.md#dk_state_unknown_key).
- **Server-mode pagination with `initialData` but no `rowCount`** shows one page until the first
  fetch: pass the server's total.
- **`useDataTable` called in a server component** (Next.js app router): Next reports `Attempted to
  call useDataTable() from the server`. Call it in a `'use client'` file (see
  [React](react.md#which-package)).

## See also

- [Server mode](server-mode.md) — the fetcher, `rowCount` and the statuses.
- [React](react.md) — `useDataTable` and `<DataTable />`.
- [State](state.md) — `initialState` and controlled slices.
- [`datakable` SSR](../../packages/datakable/README.md#ssr)
- [Server rendering with Next.js](../examples/nextjs-ssr.md) — the recipe.
- [SSR and hydration problems](../how-to-fix/ssr-and-hydration.md) — troubleshooting.
- [Examples](../examples/README.md)
