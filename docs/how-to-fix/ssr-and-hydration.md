# SSR and hydration problems

A server-rendered table shows Loading instead of rows, React reports a hydration error ("Hydration
failed…", "Text content did not match"), the page flashes as the server HTML is replaced, or
DataKable reports [`DK_HYDRATION_MISMATCH`](errors.md#dk_hydration_mismatch) /
[`DK_SSR_ASYNC_DEFERRED`](errors.md#dk_ssr_async_deferred).

## Confirm: what differs?

- **Loading in the server HTML:** look for `data-status="pending"` on the `<DataTable />` root in
  the page source, and `DK_SSR_ASYNC_DEFERRED` (`info`) in the server log —
  [no rows on the server](#the-server-html-has-no-rows).
- **React's hydration error:** the server and the browser rendered different text. The usual
  sources are state only the browser has
  ([browser-only state](#browser-only-state-while-rendering)) and
  [dates](#dates-formatted-differently). Rows in a different order after hydration:
  [text sorted differently](#text-sorted-differently).
- **`DK_HYDRATION_MISMATCH`:** the table changed between the browser creating it and React
  finishing hydration; the diagnostic names the state slices (`"sorting" differ…`).

## The server HTML has no rows

Rendering starts no async work: a table with a `fetcher` and no `initialData` renders
`status: 'pending'` (`<DataTable />` shows Loading) and fetches in the browser after hydration.

**Fix:** fetch the first page on the server, for the same initial state (for instance parsed from
the request URL), and pass it as `initialData`, with `rowCount` for server pagination:

```tsx
import {
  DataTable,
  type FetchParams,
  type FetchResult,
  pagination,
  sorting,
  withFetcher,
} from 'datakable/react'

type User = { id: number; name: string }

async function fetchUsers({ sort, pageIndex, pageSize, signal }: FetchParams) {
  const order = (sort ?? []).map((s) => `${s.desc ? '-' : ''}${s.id}`).join(',')
  const res = await fetch(`/api/users?sort=${order}&page=${pageIndex}&size=${pageSize}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as FetchResult<User>
}

const features = [sorting({ mode: 'server' }), pagination({ mode: 'server', pageSize: 20 })]
const fetcher = withFetcher(fetchUsers)

// `firstPage` and `rowCount` are fetched on the server, for the same initial state. The server
// HTML has the rows, and hydration does not fetch them again.
export function Users({ firstPage, rowCount }: { firstPage: User[]; rowCount: number }) {
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

Client-mode features need nothing: `initialState` (say `?q=ada&sort=-age`, parsed on both sides)
applies on the server, so the HTML is already filtered, searched and sorted.

## Browser-only state while rendering

Reading `localStorage`, `window` or a browser-only URL parse while rendering gives the browser a
different initial state from the server: React hydrates text that does not match. Changing the
table during the hydrating render (calling a table method in the component body) is reported as
`DK_HYDRATION_MISMATCH`, and React replaces the server HTML at once (a visible flash).

**Fix:** give the server and the browser the same initial state, and apply browser-only state in
an effect, after hydration:

```tsx
import { type SortingState, useDataTable } from 'datakable/react'
import { useEffect } from 'react'

type User = { id: number; name: string; age: number }

export function Users({ users }: { users: User[] }) {
  // The same initial state on the server and in the browser.
  const table = useDataTable({ data: users, rowKey: 'id' })
  const { setSorting } = table
  // Browser-only state (localStorage, window size, …) after hydration, not while rendering.
  useEffect(() => {
    const saved = localStorage.getItem('users.sorting')
    if (saved) setSorting((JSON.parse(saved) as SortingState<User>).by)
  }, [setSorting])
  return (
    <ul>
      {table.rowModel.rows.map((row) => (
        <li key={row.key}>{row.original.name}</li>
      ))}
    </ul>
  )
}
```

## Dates formatted differently

Without `format`, a `Date` cell is shown with `toLocaleString()`: in the server's locale and time
zone on the server, in the user's in the browser. The texts differ and React reports a mismatch.

**Fix:** format dates with an explicit locale and time zone (or render them in the browser only):

```ts
import type { ColumnDef } from 'datakable'
import type { ReactNode } from 'react'

type Order = { id: number; placed: Date }

// The default formatter uses toLocaleString(): the server's locale and time zone, then the
// browser's. Fix both, so the server HTML and the hydrated text are the same.
const dateTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

export const columns: ColumnDef<Order, ReactNode>[] = [
  { key: 'id' },
  { key: 'placed', format: (placed) => dateTime.format(placed) },
]
```

## Text sorted differently

In `@datakable/core` 1.0.0, `sorting()` without `locale` compared strings with the runtime's default
locale: the server's on the server, the user's in the browser (for instance `'Ärla'` after `'Zoë'`
in Swedish). The sorted rows differed and React reported a hydration error. Now the default is
`'en'` on both sides.

**Fix:** update `@datakable/core`. To sort in your users' language, pass the same locale to
`sorting({ locale })` on the server and in the browser (for instance from the request's
`Accept-Language`, passed down as a prop), never the browser's default.

## Related codes

[`DK_HYDRATION_MISMATCH`](errors.md#dk_hydration_mismatch) ·
[`DK_SSR_ASYNC_DEFERRED`](errors.md#dk_ssr_async_deferred) ·
[`DK_STATE_UNKNOWN_KEY`](errors.md#dk_state_unknown_key) (an `initialState` key that no longer
exists)

## See also

- [`datakable` SSR](../../packages/datakable/README.md#ssr) — the full server-mode example, and
  `createDeferred` / `startTable` for your own bindings.
- [The loading state never ends](loading-never-ends.md)
- Guide: [server rendering (SSR)](../how-to-use/ssr.md).
- [Server rendering with Next.js](../examples/nextjs-ssr.md) — the recipe.
- [How to fix](README.md) — every symptom.
