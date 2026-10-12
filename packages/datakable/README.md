# datakable

Type-safe generic data table for React: zero-config by default, headless when you need it.

This is the batteries-included entry. It re-exports [`@datakable/react`](https://github.com/Ink01101011/datakable/tree/main/packages/react) and
[`@datakable/core`](https://github.com/Ink01101011/datakable/tree/main/packages/core), and its `useDataTable` / `createTable` install the default
preset — `columnFilters()`, `validity()`, `search()`, `sorting()`, `pagination()` — when you pass no
`features`.

> Pre-release (`0.x`): the API may still change before 1.0.

## Install

```bash
npm install datakable react
```

React `>=18`. The package is ESM + CJS with types, and the React bundle carries `"use client"`.

**Bundler requirement:** DataKable reads `process.env.NODE_ENV` to strip development-only checks
and message text. Vite, webpack, Next.js, Rollup (`@rollup/plugin-replace`) and esbuild
(`--define:process.env.NODE_ENV='"production"'`) replace it; without that replacement `process` is
undefined in the browser.

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
preset entirely, and only the installed features' state and methods exist on the type.

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
| `'pending'` | a search debounce is waiting |
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

## Coming next

These are specified but not released yet:

- **`<DataTable />`** — `<DataTable data={rows} />` (zero-config) or
  `<DataTable table={useDataTable(…)} />`: sort headers with `aria-sort`, a search input
  (Enter commits, Esc clears), pagination, Loading / Empty / Error states driven by `status` +
  `isInitialLoad`, `data-invalid` on flagged rows, `components` overrides, unstyled with `data-*`
  hooks.
- **SSR** — `initialState` (e.g. from the URL) and `initialData`, pre-filtered server HTML, and
  hydration without a re-fetch.

## Entry points

| Import | What |
| --- | --- |
| `datakable` | `useDataTable` and `createTable` with the default preset, plus everything from `@datakable/react` and `@datakable/core` |
| `datakable/core` | `@datakable/core` as is (no preset by default) |
| `datakable/messages` | side-effect import: full diagnostic text in production |

## License

MIT
