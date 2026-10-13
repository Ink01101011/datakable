# Server rendering with the Next.js app router

With the app router, a server component can fetch the first page while it renders, so the HTML
arrives with rows in it and the browser does not fetch them again. The table itself is a client
component, because it handles clicks and typing.

## Goal

Render `/users?page=2` on the server with that page's users in the HTML, hydrate without a second
request, and fetch later pages and sorts from the browser.

## The code

The client component, `app/users/users-table.tsx`:

```tsx
'use client'
// app/users/users-table.tsx — a client component: it holds the table and its event handlers.

import {
  DataTable,
  type FetchParams,
  type FetchResult,
  pagination,
  sorting,
  withFetcher,
} from 'datakable'

export type User = { id: number; name: string; email: string }

export const PAGE_SIZE = 20

// Later pages (after a sort or page change) are fetched by the browser, from your route handler.
async function fetchUsers({ sort, pageIndex, pageSize, signal }: FetchParams) {
  const order = (sort ?? []).map((s) => `${s.desc ? '-' : ''}${s.id}`).join(',')
  const res = await fetch(`/api/users?sort=${order}&page=${pageIndex}&size=${pageSize}`, {
    signal,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as FetchResult<User>
}

const features = [sorting({ mode: 'server' }), pagination({ mode: 'server', pageSize: PAGE_SIZE })]
const fetcher = withFetcher(fetchUsers)

export function UsersTable(props: { firstPage: User[]; rowCount: number; pageIndex: number }) {
  return (
    <DataTable
      rowKey="id"
      features={features}
      fetcher={fetcher}
      // The server already fetched this page for this state: the HTML shows its rows, and
      // hydration does not fetch it again.
      initialData={props.firstPage}
      rowCount={props.rowCount}
      initialState={{ pagination: { pageIndex: props.pageIndex, pageSize: PAGE_SIZE } }}
      caption="Users"
    />
  )
}
```

The page, `app/users/page.tsx` (a server component):

```tsx
// app/users/page.tsx — a server component: it fetches the first page while rendering.
import type { FetchResult } from 'datakable'
import { PAGE_SIZE, type User, UsersTable } from './1-users-table' // './users-table' in your app

export default async function UsersPage(props: { searchParams: Promise<{ page?: string }> }) {
  const { page } = await props.searchParams
  const pageIndex = Math.max(Number(page ?? 1) - 1, 0) || 0
  const res = await fetch(`https://api.example.com/users?page=${pageIndex}&size=${PAGE_SIZE}`, {
    cache: 'no-store',
  })
  const { rows, rowCount = rows.length } = (await res.json()) as FetchResult<User>
  return <UsersTable firstPage={[...rows]} rowCount={rowCount} pageIndex={pageIndex} />
}
```

## What you will see

- The server HTML is the full table: the 20 users of the requested page, the pager, sort headers,
  `data-status="idle"`. No Loading state, so no layout shift.
- After hydration nothing is fetched: `initialData` counts as the result of the first request.
- Sorting or paging in the browser calls `fetchUsers`, which requests your route handler
  (`/api/users?sort=name&page=0&size=20`), and the rows update.
- A missing or invalid `?page=` is the first page.

## Variations

- **No `initialData`:** the server renders the Loading state (`status: 'pending'`, reported as
  [`DK_SSR_ASYNC_DEFERRED`](../how-to-fix/errors.md#dk_ssr_async_deferred)) and the browser fetches right after hydration. Fine for data that must
  not be in the HTML; worse for first paint.
- **Client-side data:** pass the whole array as `data` instead of `fetcher` and `initialData`;
  `initialState` (parsed from `searchParams`) then filters, searches and sorts the server HTML.
- **Keep the page in the URL:** control `pagination` and `sorting` and write them back with the
  router ([Keep the table's state in the URL](url-state.md)); on the server, parse them into
  `initialState`.
- **Render `<DataTable />` from the server component:** its module is marked `'use client'` (in
  `datakable` and in `@datakable/react`), so a server component can render it directly. The
  features and the fetcher are functions, though, which cannot be passed from a server component;
  keep them in a client file as here.
- **Without React:** `createDeferred` / `startTable` give your own bindings the same deferral
  ([SSR](../../packages/datakable/README.md#ssr)).

## See also

- [SSR](../../packages/datakable/README.md#ssr) in `datakable` and in
  [`@datakable/react`](../../packages/react/README.md#ssr).
- [How to fix](../how-to-fix/README.md) — `DK_SSR_ASYNC_DEFERRED`, [`DK_HYDRATION_MISMATCH`](../how-to-fix/errors.md#dk_hydration_mismatch).
- [Server rendering (SSR)](../how-to-use/ssr.md) — the guide.
- [SSR and hydration problems](../how-to-fix/ssr-and-hydration.md) — troubleshooting.
- [Examples](README.md)
