# @datakable/react

[![npm version](https://img.shields.io/npm/v/%40datakable%2Freact?color=cb3837&logo=npm)](https://www.npmjs.com/package/@datakable/react)
[![npm downloads](https://img.shields.io/npm/dm/%40datakable%2Freact?color=cb3837)](https://www.npmjs.com/package/@datakable/react)
[![types: TypeScript](https://img.shields.io/npm/types/%40datakable%2Freact?logo=typescript&logoColor=white)](https://www.npmjs.com/package/@datakable/react)
[![license: MIT](https://img.shields.io/npm/l/%40datakable%2Freact)](https://github.com/Ink01101011/datakable/blob/main/LICENSE)

React bindings for DataKable: the `useDataTable` hook over the
[`@datakable/core`](https://github.com/Ink01101011/datakable/tree/main/packages/core) table store. Most apps want
[`datakable/react`](https://github.com/Ink01101011/datakable/tree/main/packages/datakable), whose `useDataTable` also installs the default feature
preset; this package installs **no** features unless you pass them.

> Version 1.0: the public API is stable and follows semantic versioning from here. Guides,
> examples and troubleshooting: the [documentation](https://github.com/Ink01101011/datakable/blob/main/docs/README.md).

```bash
npm install @datakable/react @datakable/core react
```

React `>=18`. The modules of `<DataTable />` and `useDataTable` carry a `"use client"` directive,
so the Next.js app router treats them as client code even when a server component imports them
from here; the rest (core's `createTable`, …) stays usable on the server. Like core,
it needs a bundler that replaces `process.env.NODE_ENV` (see [core](https://github.com/Ink01101011/datakable/tree/main/packages/core)).
In Node.js (SSR, tests) it needs Node `>=18.18`. The types need TypeScript `>=5.4`.
`import '@datakable/react/messages'` once in the app entry keeps the full diagnostic text (core's
and `<DataTable />`'s) in production builds; it imports no React.

## useDataTable

```tsx
import { type ColumnDef, pagination, sorting } from '@datakable/core'
import { useDataTable } from '@datakable/react'
import type { ReactNode } from 'react'

type User = { id: number; name: string; age: number }

// Columns are compared by reference: define them outside the component, or memoise them
// (DK_UNSTABLE_COLUMNS warns in development when a new same-shape array arrives every render).
const columns: ColumnDef<User, ReactNode>[] = [
  { key: 'name', header: 'Name', cell: ({ value }) => <strong>{value}</strong> },
  { key: 'age', header: 'Age' },
]

export function Users({ users }: { users: User[] }) {
  // @datakable/react installs no features by default; `datakable` adds the preset.
  const table = useDataTable({
    data: users,
    rowKey: 'id',
    columns,
    features: [sorting(), pagination({ pageSize: 20 })],
  })
  return (
    <ul aria-busy={table.rowModel.status !== 'idle'}>
      {table.rowModel.rows.map((row) => (
        <li key={row.key}>{row.original.name}</li>
      ))}
    </ul>
  )
}
```

`useDataTable(options)` takes `createTable`'s options (with `cell` / `invalidCell` returning a
`ReactNode`) and returns the table — its methods plus the installed features' APIs — with
`state` and `rowModel` for this render. The returned object is new whenever the table notifies
and the same object otherwise, so it works as a `useMemo` dependency.

- The table is created once per component instance (on the first render) and destroyed on
  unmount. Renders read it through `useSyncExternalStore`.
- **Read once, at creation:** `features`, `schema`, `invalidRows`, `initialState`,
  `initialData`, `name`, `timeout`, `strict`, `diagnostics`. A new inline `features` array never
  recreates the table. Hoist a `features` array with `as const`: as a plain array type the
  table's type loses the features' methods and state.
- **Synced** through `table.setOptions` in a layout effect, never during render: `data`,
  `columns`, `rowKey`, `state`, `onStateChange`, `interceptors`, `onDiagnostic`, `fetcher`,
  `rowCount`.
- `onStateChange` and `onDiagnostic` may be inline functions. `fetcher`, `onStateChange` and
  `onDiagnostic` reach the table as stable wrappers that call the latest prop, so a new reference
  does not refetch — call `refetch()` when a value the fetcher reads changes. Wrap the fetcher
  with `withFetcher()` (`@datakable/core/server`, also exported by `datakable`), and keep the
  function you wrap stable: `withFetcher` returns the same wrapper for the same function, so
  `fetcher={withFetcher(fetchUsers)}` with a module-level `fetchUsers` is fine, but an inline
  arrow function is a new fetcher on every render and reports `DK_UNSTABLE_OPTION` in development
  (hoist it or `useCallback` it).
- `columns`, `data` and a `rowKey` function are compared by reference. In development,
  `DK_UNSTABLE_COLUMNS` / `DK_UNSTABLE_OPTION` warn when a new same-shape value arrives on every
  render. Structural comparison is not used, because a changed `format` or `accessor` would then
  go stale silently.
- Controlled slices: pass `state` and `onStateChange` (example in
  [`datakable`](https://github.com/Ink01101011/datakable/tree/main/packages/datakable#controlled-state)).
- Status-driven UI: render from `table.rowModel.status` and `isInitialLoad` (the
  [status model](https://github.com/Ink01101011/datakable/tree/main/packages/core#status-model)).

## DataTable

```tsx
import { type ColumnDef, pagination, search, sorting } from '@datakable/core'
import { DataTable } from '@datakable/react'
import type { ReactNode } from 'react'

type User = { id: number; name: string; age: number }

const columns: ColumnDef<User, ReactNode>[] = [
  { key: 'name', header: 'Name' },
  { key: 'age', header: 'Age', sortable: false },
]
// @datakable/react's DataTable renders what the installed features provide (none by default).
const features = [search(), sorting(), pagination({ pageSize: 20 })]

export function Users({ users }: { users: User[] }) {
  return <DataTable data={users} rowKey="id" columns={columns} features={features} />
}
```

`<DataTable />` renders sort headers with `aria-sort`, a search input (Enter = `flushSearch`, Esc =
`clearSearch`), pagination, and Loading / Error / Empty states from `status` + `isInitialLoad`,
for the features installed (this package installs none by default). Pass `table={useDataTable(…)}`
to render a table you set up yourself, `components` to replace the search input, pager or states,
and style it through the `data-*` hooks (`data-status`, `data-initial-load`, `data-sort`,
`data-invalid`), or import the optional `@datakable/react/styles.css` (zero-specificity rules,
themed through `--dk-*` custom properties). A `cell` that throws renders `⚠` in that cell (named
"Could not display this value" for screen readers, `DK_CALLBACK_FAILED`); so does a component it returns that throws while rendering — each such cell
has its own error boundary, and the other cells keep rendering (`DK_RENDER_FAILED`). A component
that throws elsewhere in the body shows the Error state with a retry.

## SSR

`useDataTable` and `<DataTable />` render on the server: `initialState` applies there (client-mode
features filter, search and sort the HTML), and no async work starts. The fetcher's first request
and a `searchFn` for an initial query run after hydration (`status: 'pending'` until then, shown
as Loading by `<DataTable />`), unless `initialData` holds their result, in which case hydration
does not fetch again. A table that changed before the hydration commit reports
`DK_HYDRATION_MISMATCH`. Example:
[`datakable` SSR](https://github.com/Ink01101011/datakable/tree/main/packages/datakable#ssr).

## License

MIT
