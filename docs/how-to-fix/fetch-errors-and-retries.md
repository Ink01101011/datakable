# Fetch errors and retries

The table loads through a `fetcher` and shows an error, keeps old rows, or reports
[`DK_FETCH_FAILED`](errors.md#dk_fetch_failed) /
[`DK_FETCH_BAD_RESPONSE`](errors.md#dk_fetch_bad_response). A failed request never throws into
your code and never clears the table: the previous rows stay, `status` becomes `'error'`, and a
diagnostic says what failed.

## Confirm: what failed?

| Code | Meaning |
|---|---|
| [`DK_FETCH_FAILED`](errors.md#dk_fetch_failed) | the fetcher threw or rejected (network error, an error you threw) |
| [`DK_FETCH_BAD_RESPONSE`](errors.md#dk_fetch_bad_response) | it resolved, but not with `{ rows, rowCount }` (or `rowCount < rows.length`) |
| [`DK_ASYNC_TIMEOUT`](errors.md#dk_async_timeout) | it did not settle within `timeout` (default 30 s) |
| [`DK_FETCH_ABORTED`](errors.md#dk_fetch_aborted) | `info`, not an error: a newer request replaced it (latest wins) |

The console shows the error's name only (messages can hold user data); the original error is
`d.context.cause`, passed to `onDiagnostic` only.

## The response is not `{ rows, rowCount }`

`fetch()` resolves on HTTP errors too: without a check, a `500` body such as
`{ "error": "…" }` is taken for the result and fails as `DK_FETCH_BAD_RESPONSE` ("rows is
undefined"). An API that answers `{ items, total }` fails the same way.

**Fix:** throw on a failed status, and map the API's shape:

```ts
import { createTable, type FetchParams, type FetchResult, pagination, withFetcher } from 'datakable'

type User = { id: number; name: string }
// What the API answers: { items, total }.
type UsersPage = { items: User[]; total: number }

async function fetchUsers({
  pageIndex,
  pageSize,
  signal,
}: FetchParams): Promise<FetchResult<User>> {
  const res = await fetch(`/api/users?page=${pageIndex}&size=${pageSize}`, { signal })
  // fetch() resolves on HTTP errors: throw, or the error body is taken for the rows.
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const page = (await res.json()) as UsersPage
  // Map the API's shape to { rows, rowCount } (rowCount: the total on the server).
  return { rows: page.items, rowCount: page.total }
}

export const table = createTable({
  rowKey: 'id',
  features: [pagination({ mode: 'server', pageSize: 20 })],
  fetcher: withFetcher(fetchUsers),
})
```

`rowCount` is the total number of matching rows on the server; server pagination computes the
page count from it ([`DK_ROW_COUNT_MISSING`](errors.md#dk_row_count_missing) without it).

## Retrying

`table.refetch()` runs the fetcher again with the current state and resolves with
`{ status: 'applied' | 'superseded' | 'error' }`; it never rejects. The next change of a
server-mode state (page, sort, filter, query) also fetches again. There is no automatic retry;
to retry with a backoff:

```ts
import type { FetchOutcome } from 'datakable'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Retries a failed load, waiting longer each time (1 s, 2 s, 4 s). refetch() never rejects.
export async function refetchWithRetry(
  table: { refetch(): Promise<FetchOutcome> },
  attempts = 3,
): Promise<FetchOutcome['status']> {
  for (let attempt = 0; ; attempt++) {
    const { status } = await table.refetch()
    if (status !== 'error' || attempt + 1 >= attempts) return status
    await wait(1000 * 2 ** attempt)
  }
}
```

## Showing the error

`<DataTable />` shows its Error part when the **first** load fails (`status: 'error'` with
`isInitialLoad`), with a retry button that calls `refetch()`. A later failure keeps the last good
rows and shows a refresh indicator with its own retry. Replace the part, and report the original
error to your logger:

```tsx
import {
  DataTable,
  type DataTableComponents,
  type Diagnostic,
  type FetchResult,
  pagination,
  withFetcher,
} from 'datakable/react'

type User = { id: number; name: string }

const features = [pagination({ mode: 'server', pageSize: 20 })]

const fetcher = withFetcher(async ({ pageIndex, signal }) => {
  const res = await fetch(`/api/users?page=${pageIndex}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as FetchResult<User>
})

// Shown when the first load fails; `retry` calls table.refetch(). A later failure keeps the
// last good rows and shows the refresh indicator, with its own retry button.
const components: DataTableComponents = {
  Error: ({ retry }) => (
    <p role="alert">
      Could not load the users.{' '}
      <button type="button" onClick={retry}>
        Try again
      </button>
    </p>
  ),
}

// The original error reaches onDiagnostic only (as context.cause), never the console.
const report = (d: Diagnostic) => {
  if (d.code === 'DK_FETCH_FAILED') console.error('users request failed', d.context.cause)
}

export function Users() {
  return (
    <DataTable
      rowKey="id"
      features={features}
      fetcher={fetcher}
      components={components}
      onDiagnostic={report}
    />
  )
}
```

With `useDataTable`, render the same states from `table.rowModel`: `status === 'error' &&
isInitialLoad` is "nothing loaded yet"; `status === 'error'` otherwise is "showing stale rows".

## Related codes

[`DK_FETCH_FAILED`](errors.md#dk_fetch_failed) ·
[`DK_FETCH_BAD_RESPONSE`](errors.md#dk_fetch_bad_response) ·
[`DK_ASYNC_TIMEOUT`](errors.md#dk_async_timeout) ·
[`DK_FETCH_ABORTED`](errors.md#dk_fetch_aborted) ·
[`DK_ROW_COUNT_MISSING`](errors.md#dk_row_count_missing) ·
[`DK_FETCHER_WITHOUT_SERVER_MODE`](errors.md#dk_fetcher_without_server_mode)

## See also

- [The loading state never ends](loading-never-ends.md)
- [`@datakable/core` server mode](../../packages/core/README.md#server-mode)
- Guides: [server mode](../how-to-use/server-mode.md), [statuses: loading, refreshing,
  failing](../how-to-use/server-mode.md#statuses-loading-refreshing-failing).
- [A server-side table](../examples/server-side-table.md) — the recipe.
- [How to fix](README.md) — every symptom.
