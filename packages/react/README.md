# @datakable/react

React bindings for DataKable: the `useDataTable` hook over the
[`@datakable/core`](https://github.com/Ink01101011/datakable/tree/main/packages/core) table store. Most apps want
[`datakable`](https://github.com/Ink01101011/datakable/tree/main/packages/datakable), whose `useDataTable` also installs the default feature
preset; this package installs **no** features unless you pass them.

> Pre-release (`0.x`): the API may still change before 1.0.

```bash
npm install @datakable/react @datakable/core react
```

React `>=18`. The bundle carries a `"use client"` directive. Like core, it needs a bundler that
replaces `process.env.NODE_ENV` (see [core](https://github.com/Ink01101011/datakable/tree/main/packages/core)).

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
- **Read once, at creation:** `features`, `schema`, `invalidRows`, `initialState`, `name`,
  `timeout`, `strict`, `diagnostics`. A new inline `features` array never recreates the table.
- **Synced** through `table.setOptions` in a layout effect, never during render: `data`,
  `columns`, `rowKey`, `state`, `onStateChange`, `interceptors`, `onDiagnostic`, `fetcher`,
  `rowCount`.
- `fetcher`, `onStateChange` and `onDiagnostic` may be inline functions: the table always calls
  the latest one, and a new reference does not refetch — call `refetch()` when a value the fetcher
  reads changes.
- `columns`, `data` and a `rowKey` function are compared by reference. In development,
  `DK_UNSTABLE_COLUMNS` / `DK_UNSTABLE_OPTION` warn when a new same-shape value arrives on every
  render. Structural comparison is not used, because a changed `format` or `accessor` would then
  go stale silently.
- Controlled slices: pass `state` and `onStateChange` (example in
  [`datakable`](https://github.com/Ink01101011/datakable/tree/main/packages/datakable#controlled-state)).
- Status-driven UI: render from `table.rowModel.status` and `isInitialLoad` (the
  [status model](https://github.com/Ink01101011/datakable/tree/main/packages/core#status-model)).

## Coming next

`<DataTable />` (zero-config rendering, sort headers with `aria-sort`, search input, pagination,
Loading / Empty / Error states, `components` overrides), an error boundary for `cell` renders, and
SSR (`initialState` / `initialData`, hydration without a re-fetch) are specified and land in this
package in a later release.

## License

MIT
