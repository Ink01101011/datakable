# Getting started

This page takes you from `npm install` to a working table: the zero-config `<DataTable />`, the
headless `useDataTable` hook, `createTable` without React, which package to import, and the one
bundler setting DataKable needs. Every later guide builds on what is here.

## Install

```sh
npm install datakable react
```

`datakable` needs React `>=18` and ships ESM and CJS with types. Where it runs in Node.js (SSR,
tests, scripts), it needs Node.js `>=18.18`. It depends on
[`@datakable/react`](../../packages/react/README.md) and
[`@datakable/core`](../../packages/core/README.md), which are installed with it and always share
its version.

The types need **TypeScript `>=5.4`** (they use `NoInfer`). An older TypeScript reports
`Cannot find name 'NoInfer'` with `skipLibCheck: false`; with `skipLibCheck: true` the affected
types silently become `any`. Upgrade TypeScript to 5.4 or later.

## The zero-config table

Pass your rows to `<DataTable />`. The columns are derived from the data (the keys of the first 50
rows), and the default features are installed: column filters, validity, search, sorting and
pagination.

```tsx
import { DataTable } from 'datakable'

type User = { id: number; name: string; age: number; city: string }

// The whole table: columns come from the data; sort headers, a search input, pagination and the
// Loading / Empty / Error states are built in. Unstyled: add the optional stylesheet
// (datakable/styles.css) for a default look.
export function Users({ users }: { users: User[] }) {
  return <DataTable data={users} rowKey="id" caption="Users" />
}
```

`rowKey` names the field that identifies a row (here `id`); it keeps rows stable across sorting and
paging, and it is type-checked against `User`. Without it, the row index is the key. See
[Columns and row keys](columns-and-row-keys.md).

`<DataTable />` renders no CSS of its own. For a default look, import the optional stylesheet once
in your app entry: `import 'datakable/styles.css'`. [React](react.md) covers the stylesheet, the
`data-*` styling hooks and replacing parts of the component.

## Your own markup: `useDataTable`

When you want to write the markup yourself, call the hook. It takes the same options and returns the
table: its methods, the installed features' methods, and `state` and `rowModel` for the current
render.

```tsx
import { useDataTable } from 'datakable'

type User = { id: number; name: string; age: number; city: string }

// The same table, headless: you write the markup, the hook gives you the rows and the methods.
export function UserList({ users }: { users: User[] }) {
  const table = useDataTable({ data: users, rowKey: 'id' })
  return (
    <>
      <input
        value={table.state.search.input}
        onChange={(e) => void table.setSearch(e.target.value)}
        placeholder="Search"
      />
      <button type="button" onClick={() => table.toggleSort('age')}>
        Sort by age
      </button>
      <ul>
        {table.rowModel.rows.map((row) => (
          <li key={row.key}>
            {row.original.name}, {row.original.age}
          </li>
        ))}
      </ul>
      <button type="button" disabled={!table.canNextPage()} onClick={table.nextPage}>
        More
      </button>
    </>
  )
}
```

`table.rowModel.rows` holds only the visible page. `setSearch` returns a promise that never
rejects; `void` it in an event handler. You can also hand the hook's result to
`<DataTable table={table} />` to keep the built-in rendering with your own setup.

## Without React: `createTable`

`createTable` is the same table as a plain object. It runs anywhere JavaScript runs: Node, a worker,
a test, or your own framework bindings. A bundle that uses only `createTable` contains no React.
`datakable` still lists `react` as a peer dependency (its root entry also exports the hook and the
component); a project without React can install `@datakable/core` instead and pass
`features: createDefaultFeatures()` for the same preset.

```ts
import { createTable } from 'datakable'

type User = { id: number; name: string; age: number; city: string }

const users: User[] = [
  { id: 1, name: 'Mali', age: 31, city: 'Bangkok' },
  { id: 2, name: 'Anan', age: 25, city: 'Chiang Mai' },
  { id: 3, name: 'Ploy', age: 40, city: 'Bangkok' },
]

// No React: the same table and the same default preset, in Node, a worker or a test.
const table = createTable({ data: users, rowKey: 'id' })

table.setColumnFilter('city', { type: 'equals', value: 'Bangkok' })
table.toggleSort('age')

const { rows, filteredCount } = table.getRowModel()
console.log(
  rows.map((row) => row.original.name), // ['Mali', 'Ploy']
  filteredCount, // 2
)
table.destroy()
```

Read state with `getState()` and rows with `getRowModel()` whenever you need them, or
`subscribe(listener)` to hear about every change. [Core concepts](core-concepts.md) explains the
table object; [State](state.md) explains snapshots and listeners.

## Type safety

The row type is inferred from `data` (or given explicitly: `createTable<User>({ … })`). Every
column id, filter and sort entry is checked against it, so mistakes fail to compile instead of
silently showing nothing:

```ts
import { createTable } from 'datakable'

type User = { id: number; name: string; age: number }
declare const users: User[]

const table = createTable({ data: users, rowKey: 'id' })

// Column ids are dot-paths of User and filters are checked against the value type:
// @ts-expect-error 'nmae' is not a path of User
table.toggleSort('nmae')
// @ts-expect-error a range filter needs a number, bigint or Date column
table.setColumnFilter('name', { type: 'range', value: { min: 1 } })
```

When TypeScript rejects a column, [Reading type errors](../how-to-fix/reading-type-errors.md) shows which line
of the message to read.

## Which package to import

| Package | Install it when | Default features |
| --- | --- | --- |
| `datakable` | you use React and want the batteries included | `columnFilters`, `validity`, `search`, `sorting`, `pagination` |
| `@datakable/react` | you use React and choose every feature yourself | none |
| `@datakable/core` | you do not use React (or write your own bindings) | none |

`datakable` re-exports everything from the other two, so one import line is enough. Its
`createTable`, `useDataTable` and `<DataTable />` install the default preset when you pass no
`features`; passing `features` replaces the preset entirely. The `createTable` of
`@datakable/core` (also available as `datakable/core`) installs nothing unless you pass features,
which keeps a bare import small. [Features](features.md) shows how to choose them, and
[Entry points](entry-points.md) lists every import path.

## Bundler requirement

DataKable reads `process.env.NODE_ENV` so that bundlers can remove development-only checks, tracing
and message text from production builds. Vite, webpack, Next.js, Rollup (with
`@rollup/plugin-replace`) and esbuild (with `--define`) replace it:

```sh
esbuild app.tsx --bundle --define:process.env.NODE_ENV='"production"'
```

Without a replacement, unbundled browser code throws `ReferenceError: process is not defined`, as
React and Redux do. Node needs nothing.

In development (any value other than `'production'`) you get the full checks: unknown and invalid
options, data checks, the tracer behind `explain()`, and complete diagnostic text. Production
builds keep the diagnostics themselves but drop their text unless you opt in; see
[Diagnostics](diagnostics.md).

## Next.js app router

Only the modules of `<DataTable />` and `useDataTable` are marked `"use client"`, in `datakable` as
in `@datakable/react`. `createTable` and the rest also work in server code, and a server component
that only calls `createTable` sends no table code to the browser. A server component can render
`<DataTable />` with plain data props; call `useDataTable`, or pass functions (cell components,
features, a fetcher), from a client component:

```tsx
'use client'

// app/users/users-table.tsx — a client component of the Next.js app router. Only the modules of
// <DataTable /> and useDataTable are "use client" (createTable also runs on the server); call the
// hook, or pass functions such as cell components, features or a fetcher, from a file like this.
import { DataTable } from 'datakable'

type User = { id: number; name: string }

export function UsersTable({ users }: { users: User[] }) {
  return <DataTable data={users} rowKey="id" />
}
```

A server component can fetch the rows and pass them down as props. To render the first page on
the server and hydrate it without fetching again, see [Server rendering (SSR)](ssr.md).

## Pitfalls

- **`ReferenceError: process is not defined`** in the browser: your bundler does not replace
  `process.env.NODE_ENV`. Configure it as above.
- **A new `columns` array on every render** makes the table recompute its columns each time, and
  development builds warn with [`DK_UNSTABLE_COLUMNS`](../how-to-fix/errors.md#dk_unstable_columns). Define
  columns outside the component or memoise them; see [React](react.md).
- **`toggleSort` / `setSearch` does not exist on the type**: the feature is not installed. With
  `@datakable/core` or `@datakable/react`, or with your own `features` list, only the features you
  pass are there. See [Features](features.md).
- **Duplicate or missing row keys** are reported as
  [`DK_DUPLICATE_ROW_KEY`](../how-to-fix/errors.md#dk_duplicate_row_key) /
  [`DK_MISSING_ROW_KEY`](../how-to-fix/errors.md#dk_missing_row_key), and the rows get fallback keys. Pick a
  field that is unique in every row.

## See also

- [Core concepts](core-concepts.md) — the table object, the pipeline and the status model.
- [Columns and row keys](columns-and-row-keys.md) — define columns instead of deriving them.
- [React](react.md) — `useDataTable` and `<DataTable />` in depth.
- [A zero-config table](../examples/zero-config.md) — the recipe.
- [`process is not defined`](../how-to-fix/process-is-not-defined.md) — when the bundler requirement
  is not met.
- [Examples](../examples/README.md) — complete recipes.
- [`datakable` README](../../packages/datakable/README.md) — the package reference.
