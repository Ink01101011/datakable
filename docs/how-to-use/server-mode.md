# Server mode

This page is for tables whose rows live on a server: filtering, search, sorting or paging done by
your API instead of in the browser. It covers the `mode` option every pipeline feature takes, the
`fetcher` that lets the table load its own data, `rowCount`, `refetch()` and the statuses a
server-backed table goes through.

## Client and server steps

Every pipeline feature — `columnFilters()`, `search()`, `sorting()`, `pagination()` — takes
`mode: 'client' | 'server'` (default `'client'`). A client-mode step runs in the browser over the
rows the table holds. A server-mode step only holds its state slice: its row model step is skipped,
and its state goes to the `fetcher` (or your own fetching code), which returns the rows the server
already filtered, searched, sorted or paged.

Server steps must form a **prefix** of the pipeline `filter → search → sort → paginate`: the server
handles the first steps, and client steps may follow them. Server filter and search with client
sort and paging is fine; server paging followed by client search is not, because the client would
search one page only. A violation throws `DatakableConfigError` with `DK_MODE_ORDER` at creation
(a development check: the configuration is static, so production builds skip it).

```ts
import { columnFilters, createTable, pagination, search, sorting } from '@datakable/core'

type Order = { id: string; customer: string; total: number }
declare const firstPage: Order[]

// Server steps first, client steps after them: the server filters and searches, and the client
// sorts and pages the rows it returned. Listing the features in another order changes nothing:
// the pipeline always runs filter → search → sort → paginate.
const table = createTable({
  data: firstPage,
  rowKey: 'id',
  features: [
    columnFilters({ mode: 'server' }),
    search({ mode: 'server' }),
    sorting(), // 'client' is the default
    pagination({ pageSize: 25 }),
  ],
})

// The server-mode slices only hold state: these calls change it, and the app (or a fetcher)
// loads the matching rows.
table.setColumnFilter('total', { type: 'range', value: { min: 100 } })
void table.setSearch('acme')
```

`validity()` has no `mode`: it filters rows flagged by a schema in the browser (see
[Validity](validity.md)).

## Loading data with a fetcher

With a `fetcher`, the table loads its own rows. Wrap the function with `withFetcher()` from
`@datakable/core/server` (also exported by `@datakable/core` and `datakable`): the wrapper carries
the server source, so a table without a fetcher does not bundle it. A raw function is a compile
error, and `DK_INVALID_OPTION` in every build.

```ts
import { createTable, type FetchParams, type FetchResult } from '@datakable/core'
import { columnFilters } from '@datakable/core/column-filters'
import { pagination } from '@datakable/core/pagination'
import { search } from '@datakable/core/search'
import { withFetcher } from '@datakable/core/server'
import { sorting } from '@datakable/core/sorting'

type Order = { id: string; customer: string; total: number }

// Receives only the state of the server-mode features, and an AbortSignal.
async function fetchOrders({ query, filters, sort, pageIndex, pageSize, signal }: FetchParams) {
  const params = new URLSearchParams({
    q: query ?? '',
    filters: JSON.stringify(filters ?? {}),
    sort: (sort ?? []).map((s) => `${s.desc ? '-' : ''}${s.id}`).join(','),
    page: String(pageIndex),
    size: String(pageSize),
  })
  const res = await fetch(`/api/orders?${params}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  // rowCount is the total on the server: required with server-mode pagination.
  return (await res.json()) as FetchResult<Order>
}

const table = createTable({
  rowKey: 'id',
  features: [
    columnFilters({ mode: 'server' }),
    search({ mode: 'server' }), // typing: debounce 300 ms, minLength 2
    sorting({ mode: 'server' }),
    pagination({ mode: 'server', pageSize: 20 }),
  ],
  // Wrapped with withFetcher: a table without a fetcher does not bundle the server source.
  fetcher: withFetcher(fetchOrders),
  timeout: 10_000, // default 30 000 ms; Infinity disables it
})

// Runs at creation, then on every change of the server-mode state: here, one request for page 2.
table.nextPage()
```

The fetcher runs at creation and again whenever the state of a server-mode feature changes. For
the search slice only the applied `query` counts: typing (`input`) does not fetch. Every request
goes through one async control:

- **Latest wins.** A new request aborts the one in flight (its `signal` is aborted); a superseded
  result is never applied, even if the fetcher ignores the signal.
- **Timeout.** A request still running after `timeout` ms (default 30 000) is aborted and reported
  as `DK_ASYNC_TIMEOUT`. `timeout: Infinity` disables the timer; `timeout` is read once, at
  creation.
- **Validated result.** The result must be `{ rows, rowCount? }`. A missing `rows`, a `rowCount`
  that is not an integer ≥ 0, a `rowCount` smaller than `rows.length`, or no `rowCount` with
  server-mode pagination is `DK_FETCH_BAD_RESPONSE`.
- **Same ingest as `data`.** Returned rows go through `schema` (see
  [Schema validation](schema-validation.md)), `rowKey` and the data checks.
- **Failures keep the rows.** A fetcher that throws or rejects reports `DK_FETCH_FAILED` (the
  original error is `context.cause` in `onDiagnostic`), sets `status: 'error'` and keeps the
  previous rows. An `AbortError` is not a failure.

A `fetcher` with no server-mode feature throws `DatakableConfigError` (`DK_FETCHER_WITHOUT_SERVER_MODE`)
at creation and on `setOptions({ fetcher })`.

### `FetchParams`

What the fetcher receives. Each field is present only when the feature it comes from is installed
in server mode.

| Field | Type | From |
| --- | --- | --- |
| `query` | `string` | `search({ mode: 'server' })`: the applied query (`''` for none) |
| `filters` | `Readonly<Record<string, unknown>>` | `columnFilters({ mode: 'server' })`: the slice, one filter per column id |
| `sort` | `readonly { id: string; desc: boolean }[]` | `sorting({ mode: 'server' })`: the sort entries, first key first |
| `pageIndex` | `number` | `pagination({ mode: 'server' })` |
| `pageSize` | `number` | `pagination({ mode: 'server' })` |
| `signal` | `AbortSignal` | always: aborted when the request is superseded, timed out or the table is destroyed |

### `FetchResult<T>`

What the fetcher resolves with (or returns synchronously).

| Field | Type | |
| --- | --- | --- |
| `rows` | `readonly T[]` | the rows to show (with a schema: raw rows, validated like `data`) |
| `rowCount` | `number` (optional) | the total number of matching rows on the server. Required with server-mode pagination, which counts pages as `ceil(rowCount / pageSize)`; otherwise it defaults to `rows.length`. The row model's counts stay the page's length ([Counting rows in server mode](#counting-rows-in-server-mode)) |

### Changing the fetcher

`setOptions({ fetcher })` with a new reference runs it at once, even with the same params.
`withFetcher` is memoised per function, so wrapping the same function again returns the same
wrapper. In React, `useDataTable` hands the table a stable wrapper that always calls the latest
`fetcher` prop, so a new reference does not fetch; call `refetch()` when a value your fetcher reads
(a prop, a context value) changes. See [React](react.md#options-read-once-and-synced).

## Retrying with `refetch()`

`table.refetch()` runs the fetcher again with the current params, for example from a Retry button.
It never rejects; it resolves with a `FetchOutcome`:

| `status` | Meaning |
| --- | --- |
| `'applied'` | the rows were loaded |
| `'superseded'` | a newer request (or `destroy()`) replaced this one |
| `'error'` | it failed (`DK_FETCH_FAILED`, `DK_FETCH_BAD_RESPONSE`, `DK_ASYNC_TIMEOUT`); the previous rows are kept |

Without a fetcher, `refetch()` resolves `{ status: 'applied' }` at once.

```ts
import { createTable, type FetchResult } from '@datakable/core'
import { pagination } from '@datakable/core/pagination'
import { withFetcher } from '@datakable/core/server'

type Order = { id: string; total: number }

const table = createTable({
  rowKey: 'id',
  features: [pagination({ mode: 'server' })],
  fetcher: withFetcher(async ({ pageIndex, pageSize, signal }) => {
    const res = await fetch(`/api/orders?page=${pageIndex}&size=${pageSize}`, { signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as FetchResult<Order>
  }),
})

// A failed request keeps the previous rows, sets status 'error' and reports DK_FETCH_FAILED.
// refetch() runs the fetcher again with the current params. It never rejects.
const { status } = await table.refetch()
if (status === 'applied') console.log(table.getRowModel().rows.length, table.getPageCount())
else if (status === 'error') console.log('still failing; the previous rows stay')
// 'superseded': a newer request (or destroy()) replaced this one.
```

## Statuses: loading, refreshing, failing

`getRowModel()` (`table.rowModel` in React) reports what the fetcher is doing:

- `status: 'fetching'` while a request is in flight — the initial load, or a page, sort, filter or
  query change.
- `status: 'error'` after a failed request, until a request applies. During a `refetch()` after an
  error the status stays `'error'` (it outranks `'fetching'`); follow the retry with the promise
  `refetch()` returns.
- `isInitialLoad: true` until the first rows are applied (an empty result counts). With
  `isInitialLoad`, `'fetching'` is a full loading state and `'error'` an error with nothing behind
  it; without it, both show over the previous rows.

```tsx
import {
  type FetchParams,
  type FetchResult,
  pagination,
  sorting,
  useDataTable,
  withFetcher,
} from 'datakable'

type Order = { id: string; customer: string; total: number }

async function fetchOrders({ sort, pageIndex, pageSize, signal }: FetchParams) {
  const order = (sort ?? []).map((s) => `${s.desc ? '-' : ''}${s.id}`).join(',')
  const res = await fetch(`/api/orders?sort=${order}&page=${pageIndex}&size=${pageSize}`, {
    signal,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as FetchResult<Order>
}

// Hoisted: features are read once (`as const` keeps their APIs on the type), and a hoisted
// fetcher is the same wrapper on every render.
const features = [
  sorting({ mode: 'server' }),
  pagination({ mode: 'server', pageSize: 20 }),
] as const
const fetcher = withFetcher(fetchOrders)

export function Orders() {
  const table = useDataTable({ rowKey: 'id', features, fetcher })
  const { rows, status, isInitialLoad } = table.rowModel

  // Nothing to show yet: a full loading state, or an error with nothing behind it.
  if (isInitialLoad && status === 'error') {
    return (
      <p role="alert">
        Could not load the orders.{' '}
        <button type="button" onClick={() => void table.refetch()}>
          Retry
        </button>
      </p>
    )
  }
  if (isInitialLoad) return <p role="status">Loading orders…</p>

  // Loaded once: later requests show over the previous rows.
  return (
    <section aria-busy={status === 'fetching'}>
      {status === 'fetching' && <p role="status">Updating…</p>}
      {status === 'error' && (
        <p role="alert">
          Could not refresh; showing the previous page.{' '}
          <button type="button" onClick={() => void table.refetch()}>
            Retry
          </button>
        </p>
      )}
      <ul>
        {rows.map((row) => (
          <li key={row.key}>
            {row.original.customer}: {row.original.total}
          </li>
        ))}
      </ul>
      <button type="button" disabled={!table.canNextPage()} onClick={table.nextPage}>
        Next page
      </button>
    </section>
  )
}
```

The full status model is in [Core concepts](core-concepts.md); `<DataTable />` renders these states
for you ([React](react.md#loading-error-empty-and-refreshing)).

## Server mode without a fetcher

You can also fetch yourself. With server-mode features and no `fetcher`, core only holds their
state: subscribe to it, load the matching page, and pass it in with `setOptions({ data, rowCount })`.
`data` is the current page only, and the `rowCount` option is the total on the server, which
server-mode pagination uses for its page count.

```ts
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
```

The `rowCount` option has no effect with a fetcher (the count comes from the fetcher result) or
without server-mode pagination; both are reported as `DK_OPTION_NO_EFFECT` in development.

## Counting rows in server mode

The row model counts the rows the table holds. In server mode that is the page the server
returned: `filteredCount` and `totalCount` are both the page's length, not the number of matching
rows on the server (the table never sees those rows). The server's total is the `rowCount` of the
fetcher result (or the `rowCount` option without a fetcher); server-mode pagination uses it for
`getPageCount()`. For "N results", keep it from the result:

```ts
import { createTable, type FetchParams, type FetchResult } from '@datakable/core'
import { pagination } from '@datakable/core/pagination'
import { withFetcher } from '@datakable/core/server'

type Order = { id: string; total: number }
declare function fetchOrders(params: FetchParams): Promise<FetchResult<Order>>

// The server's total for "N results": the row model only counts the rows the table holds.
let matching = 0

const table = createTable({
  rowKey: 'id',
  features: [pagination({ mode: 'server', pageSize: 20 })],
  fetcher: withFetcher(async (params: FetchParams) => {
    const result = await fetchOrders(params)
    if (!params.signal.aborted) matching = result.rowCount ?? result.rows.length
    return result
  }),
})

// Once the first page is applied (the fetcher runs at creation):
table.subscribe(() => {
  const { rows, filteredCount, totalCount, status } = table.getRowModel()
  if (status !== 'idle') return
  console.log(rows.length, filteredCount, totalCount) // 20 20 20: the current page
  console.log(matching, table.getPageCount()) // 5000 250: the server's total and its pages
})
```

## Search in server mode

`search({ mode: 'server' })` changes the typing defaults so that each keystroke does not send a
request: `typing` defaults to `{ strategy: 'debounce', wait: 300, minLength: 2 }` (an input shorter
than 2 characters, trimmed, is sent as an empty query). Anything you pass in `typing` overrides
these. `threshold`, `fuzzyMaxDistance`, `caseSensitive` and `searchFn` do nothing in server mode:
the server matches the query. Details in [Search](search.md).

## Pitfalls

- **A client step before a server step** throws at creation:
  [`DK_MODE_ORDER`](../how-to-fix/errors.md#dk_mode_order). Put the server-mode features first in the
  pipeline order, or switch the earlier step to `'server'` too.
- **A fetcher with every feature in client mode** throws:
  [`DK_FETCHER_WITHOUT_SERVER_MODE`](../how-to-fix/errors.md#dk_fetcher_without_server_mode).
- **A fetcher passed without `withFetcher()`** throws
  [`DK_INVALID_OPTION`](../how-to-fix/errors.md#dk_invalid_option) in every build (and does not compile).
- **No `rowCount` in the result with server-mode pagination** keeps the previous rows:
  [`DK_FETCH_BAD_RESPONSE`](../how-to-fix/errors.md#dk_fetch_bad_response).
- **A slow endpoint** is aborted after 30 s: [`DK_ASYNC_TIMEOUT`](../how-to-fix/errors.md#dk_async_timeout).
  Raise `timeout`, or pass `Infinity`.
- **A failing request** keeps the previous rows with `status: 'error'`:
  [`DK_FETCH_FAILED`](../how-to-fix/errors.md#dk_fetch_failed). Show a retry that calls `refetch()`.
- **Server-mode pagination without a fetcher and without `rowCount`** shows one page:
  [`DK_ROW_COUNT_MISSING`](../how-to-fix/errors.md#dk_row_count_missing).
- **Reading `filteredCount` as the server's total** — in server mode it is the length of the
  current page; keep the fetcher result's `rowCount`
  ([Counting rows in server mode](#counting-rows-in-server-mode)).
- **Superseded requests** are reported as [`DK_FETCH_ABORTED`](../how-to-fix/errors.md#dk_fetch_aborted)
  (info): a newer request replaced them, which is expected while the user types or pages quickly.

## See also

- [Core concepts](core-concepts.md) — the row model and the status precedence.
- [Pagination](pagination.md), [Sorting](sorting.md), [Column filters](column-filters.md),
  [Search](search.md) — each feature's `mode` option.
- [Server rendering (SSR)](ssr.md) — `initialData`: fetch the first page on the server.
- [React](react.md) — `useDataTable` with a fetcher.
- [`@datakable/core` server mode](../../packages/core/README.md#server-mode)
- [A server-side table](../examples/server-side-table.md) and [search through an
  API](../examples/async-search.md) — recipes.
- [Fetch errors and retries](../how-to-fix/fetch-errors-and-retries.md) and [the loading state never
  ends](../how-to-fix/loading-never-ends.md) — troubleshooting.
- [Examples](../examples/README.md)
