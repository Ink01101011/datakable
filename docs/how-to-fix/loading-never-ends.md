# The loading state never ends

The table shows Loading (or a spinner bound to `status`) and never shows rows, or `status` never
goes back to `'idle'`. `status` always says what the table is waiting for, and every change of it
notifies subscribers — so the cause is the value it is stuck at.

## Confirm: which status, and since when?

`table.rowModel.status` (`getRowModel().status` without React) and `isInitialLoad` tell what the
table is doing. `<DataTable />` writes both on its root element, so you can read them in the
browser's devtools without changing code:

```tsx
import { DataTable } from 'datakable'

type User = { id: number; name: string }

// <DataTable /> writes the row model's status on its root element:
// <div data-datakable data-status="fetching" data-initial-load="true">…
// Inspect it in the browser's devtools, or style it.
export function Users({ users }: { users: User[] }) {
  return <DataTable data={users} rowKey="id" caption="Users" />
}
```

`String(table.explain())` ends with the same `status` and the number of open diagnostics.

| `status` stuck at | Waiting for | Read |
|---|---|---|
| `'fetching'` | a `fetcher` request | [a request that never settles](#a-request-that-never-settles) |
| `'pending'` | async work deferred to the client, a search debounce, or time-sliced work | [pending after a server render](#pending-after-a-server-render) |
| `'error'` | a request to apply after a failure | [error until a request applies](#error-until-a-request-applies) |
| `'searching'` | an async `searchFn` | the same as `'fetching'`, for `searchFn` |
| `'validating'` | an async `schema` | the schema's `validate` promise |

A custom loading UI should follow the same rule as `<DataTable />`: Loading while
`isInitialLoad` is `true` and `status` is neither `'idle'` nor `'error'`; once the table has had
rows, a refresh indicator over the rows instead (the
[status model](../../packages/core/README.md#status-model)).

## A request that never settles

A fetcher whose promise never resolves or rejects — an API that does not answer, a `fetch` without
a server timeout, a promise that misses a branch — keeps the table `'fetching'` until the table's
`timeout` (default **30 s**). Then the request fails with
[`DK_ASYNC_TIMEOUT`](errors.md#dk_async_timeout), the request's `signal` is aborted, and `status`
becomes `'error'`.

**Fix:** pass the `signal` to `fetch` (so an aborted request stops), and set the `timeout` your
users should wait:

```ts
import { createTable, type FetchParams, type FetchResult, pagination, withFetcher } from 'datakable'

type User = { id: number; name: string }

async function fetchUsers({ pageIndex, pageSize, signal }: FetchParams) {
  // Pass the signal: a superseded or timed-out request is aborted, not left running.
  const res = await fetch(`/api/users?page=${pageIndex}&size=${pageSize}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as FetchResult<User>
}

export const table = createTable({
  rowKey: 'id',
  features: [pagination({ mode: 'server', pageSize: 20 })],
  fetcher: withFetcher(fetchUsers),
  // A request still running after 10 s fails with DK_ASYNC_TIMEOUT (the default is 30 s).
  timeout: 10_000,
})
```

## Pending after a server render

Rendering on the server starts no async work: without `initialData`, the server HTML has no rows
and `status: 'pending'` ([`DK_SSR_ASYNC_DEFERRED`](errors.md#dk_ssr_async_deferred)), and the
browser starts the first request right after hydration. It stays `'pending'` when that never
happens:

- the page is not hydrated (JavaScript failed to load, or the HTML is served as static);
- your own bindings create the table inside `createDeferred(…)` and never call
  `startTable(table)` on the client.

**Fix:** fetch on the server and pass the result as `initialData` (with `rowCount` for server
pagination) — see [SSR and hydration problems](ssr-and-hydration.md) — or start the table once
mounted. `'pending'` is also normal for a moment while a search debounce waits
([search](search-finds-nothing-or-is-slow.md#the-query-is-not-applied-yet)) or a large sort or
search index is built in slices.

## Error until a request applies

After a failed request, `status` stays `'error'` (with the last good rows still shown) until a
request applies. A `refetch()` keeps it `'error'` while it runs: `status` follows the rows, not the
attempt. Await the promise `refetch()` returns to follow the retry (`{ status: 'applied' |
'superseded' | 'error' }`, never rejected). See [fetch errors and retries](fetch-errors-and-retries.md).

## Related codes

[`DK_ASYNC_TIMEOUT`](errors.md#dk_async_timeout) ·
[`DK_FETCH_FAILED`](errors.md#dk_fetch_failed) ·
[`DK_SSR_ASYNC_DEFERRED`](errors.md#dk_ssr_async_deferred) ·
[`DK_SEARCH_FAILED`](errors.md#dk_search_failed) ·
[`DK_FETCH_ABORTED`](errors.md#dk_fetch_aborted)

## See also

- [Fetch errors and retries](fetch-errors-and-retries.md)
- [SSR and hydration problems](ssr-and-hydration.md)
- [How to fix](README.md) — every symptom.
