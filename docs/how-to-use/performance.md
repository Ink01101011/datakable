# Performance

DataKable is built for low-end devices: the CPU time, memory and bundle bytes it uses are your
users' cost. This page lists the budgets DataKable is held to, how the table meets them (so you
know what is cheap and what is not), and what to do in your app to keep it fast: stable
references, pagination or server mode for large data, and imports that bundle only what you use.

## Budgets

These are acceptance targets of the [design spec](../superpowers/specs/2026-10-12-core-api-design.md)
(§9.3), enforced in CI against the built packages in production mode.

| Budget | Target |
| --- | --- |
| `@datakable/core` `createTable` (gzip) | ≤ 15 KB |
| `@datakable/core` `createTable` + `columnFilters` + `sorting` + `pagination` (gzip) | ≤ 24 KB |
| `datakable` `createTable`, default preset (gzip) | ≤ 27 KB |
| `datakable` `useDataTable`, default preset + hook (gzip) | ≤ 28.5 KB |
| `datakable` `<DataTable />`, default preset + component (gzip) | ≤ 31.5 KB |
| Pipeline memory at 100k rows, excluding the data itself | ≤ 5 MB (paginated, unpaginated and with a client search) |
| Interaction (type, sort, page) on 10k rows, client mode, 4x CPU throttle | < 100 ms |
| Longest task while building the search projection for 100k rows | ≤ 50 ms |
| Interceptor overhead per column batch vs a raw loop | ≤ +10% |

Sizes are measured with esbuild, minified, `process.env.NODE_ENV = "production"`, gzip; React and
DataKable's own dependencies (`exsorted`, `ex-search`, `kk-debounce`) are external. Core with
`search` as well is measured but has no budget. `datakable/styles.css` is about 1 kB gzip and is
optional. Contributors run the checks with:

```sh
pnpm build
pnpm size           # print the size of each entry
pnpm check:budgets  # sizes against their limits, then the memory and interaction budgets
```

## How the table stays fast

- **An index pipeline.** Every step (filter, search, sort, paginate) reads and returns a
  `Uint32Array` of row indices; your row objects are never copied or wrapped while the pipeline
  runs. Each step is memoised on its input and its own state slice, so changing the page does not
  filter or sort again, and typing in search does not re-run the filters.
- **`Row` objects only for what you read.** `getRowModel().rows` holds the visible rows (the
  current page), and builds each `Row` the first time you read it. An unpaginated table of 90k rows
  does not create 90k objects until you iterate them.
- **A column cache.** A column's values are read once per `data` reference, lazily, only for the
  columns a step needs (a filter, a sort, search). An all-number column is stored as a
  `Float64Array`. The cache is keyed by the data array in a `WeakMap`, so it is released with the
  data.
- **Search** builds its matcher once per data and columns (not per keystroke), over the column
  cache, and reads the searchable values a chunk of rows at a time without keeping a copy.
- **Sorting** picks a stable algorithm per sort from one scan of the keys (`algorithm: 'auto'`):
  integer and date keys go to tim / counting / radix sort, and from 10k rows a string column is
  sorted by precomputed collation ranks instead of calling `Intl.Collator` per comparison. See
  [Sorting](sorting.md).
- **Time-slicing.** Work that can take more than 50 ms on large data (the search projection, the
  collation ranks) runs in slices of a few milliseconds, yielding through `scheduler.yield()` (or
  `setTimeout` where it is missing, `DK_ENV_FALLBACK`). Meanwhile the row model keeps the previous
  rows with `status: 'pending'`, and it updates when the work is done. Slicing only happens in the
  browser after the first row model; the server and the first render compute synchronously.
- **Cell callbacks per column, not per cell.** Your `format`, `accessor`, filter `fn` and `sortBy`
  run in one `column:batch` per column per pipeline run, with an inline `try/catch`; interceptors
  and the error boundary see one call per column. Failures are recorded as numbers, and text is
  built only when something failed.
- **Bounded memory.** The diagnostics buffer keeps 100 entries, the tracer keeps the last run
  (counts, never rows), and `getInvalidRows()` stores indices and issues, not copies.
- **Development-only machinery.** Option validation, data checks, version checks, the tracer and
  the diagnostic text are removed from production builds.

## What you can do

### Keep `data` and `columns` stable

The caches and memoised steps are keyed by reference: a new `data` array means a new ingest (row
keys, schema, column cache), and a new `columns` array means the column cache and the search
matcher are rebuilt. In React, hoist `columns` out of the component (or `useMemo` them) and
memoise derived data:

```ts
// Only what is imported is bundled: the bare table, and the two features this table uses.
import { createTable } from '@datakable/core'
import { pagination } from '@datakable/core/pagination'
import { sorting } from '@datakable/core/sorting'

type Order = { id: string; total: number; placedAt: Date }
declare const orders: Order[]

const table = createTable({
  data: orders,
  rowKey: 'id',
  features: [sorting(), pagination({ pageSize: 50 })],
})
table.toggleSort('placedAt')
```

In development, `DK_UNSTABLE_COLUMNS` / `DK_UNSTABLE_OPTION` warn when a new array with the same
shape arrives on every render. See [React](react.md).

### Change data with a new array

The table notices new data by reference. Mutating the array you passed and passing it again keeps
the old caches and the old rows (development reports `DK_DATA_MUTATED`):

```tsx
import { type ColumnDef, DataTable } from 'datakable'
import type { ReactNode } from 'react'
import { useMemo } from 'react'

type Order = { id: string; total: number; status: 'open' | 'paid' }

// Columns compared by reference: hoisted, so every render passes the same array.
const columns: ColumnDef<Order, ReactNode>[] = [
  { key: 'id', header: 'Order' },
  { key: 'total', header: 'Total', format: (v) => v.toFixed(2) },
  { key: 'status', header: 'Status' },
]

export function Orders({ orders, onlyOpen }: { orders: Order[]; onlyOpen: boolean }) {
  // Derived data memoised: a new array only when its inputs change, so the table re-ingests
  // (and rebuilds its caches) only then.
  const data = useMemo(
    () => (onlyOpen ? orders.filter((o) => o.status === 'open') : orders),
    [orders, onlyOpen],
  )
  return <DataTable data={data} rowKey="id" columns={columns} />
}
```

### Page large tables, or let the server do the work

- **Paginate.** Rendering is usually the most expensive part, and the table only builds the rows
  you show. With `pagination()` the DOM stays at one page, whatever the data size.
- **Use server mode for very large data.** Client mode keeps the whole data set in memory and
  filters, searches and sorts it in the browser; the budgets above are measured up to 100k rows.
  Beyond that, or when the data is not on the client, set `mode: 'server'` on the features and
  load pages with a `fetcher`. See [Server mode](server-mode.md).
- **Search the columns that matter.** Give the searchable columns a `search` weight; when one
  column declares a weight, only the columns with one are searched. See [Search](search.md).
- **Read `DK_PERF_HINT`.** In development, the tracer reports a pipeline step that took longer
  than 50 ms, with its numbers and a suggestion. `explain()` shows the time per step. See
  [Diagnostics](diagnostics.md).

### Bundle only what you use

- `datakable`'s `createTable`, `useDataTable` and `<DataTable />` install the default preset (all
  five features). If you need fewer features, pass `features` (which replaces the preset), or
  import the bare table from `@datakable/core` and one entry per feature, so the others are not
  bundled:

```ts
import { createTable } from 'datakable'

type Order = { id: string; total: number }
declare const initial: Order[]
declare const incoming: Order

const table = createTable({ data: initial, rowKey: 'id' })

// Pass a new array: the caches are per data reference, so the table sees the change.
table.setOptions({ data: [...table.getData(), incoming] })

// Not this: the same array mutated keeps the old caches (DK_DATA_MUTATED in development).
// initial.push(incoming); table.setOptions({ data: initial })
```

- Schema validation, the server source and the async `searchFn` engine are opt-in imports:
  `withSchema` (`@datakable/core/schema`), `withFetcher` (`@datakable/core/server`) and
  `withSearchFn` (`@datakable/core/search-async`). A table that does not use them does not bundle
  them.
- Let your bundler replace `process.env.NODE_ENV` (Vite, webpack, Next.js, Rollup with
  `@rollup/plugin-replace`, esbuild with `--define`), so production builds drop the development
  checks and the message text. See [Getting started](getting-started.md).
- Import `datakable/messages` only when you need the diagnostic text in production: it adds the
  text of every code back to the bundle.
- `datakable/styles.css` is optional; without it DataKable adds no CSS.

The full list of import paths is on [Entry points](entry-points.md).

## Pitfalls

- **A new `columns` or `data` array on every render** rebuilds the caches each time:
  [`DK_UNSTABLE_COLUMNS`](../how-to-fix/errors.md#dk_unstable_columns),
  [`DK_UNSTABLE_OPTION`](../how-to-fix/errors.md#dk_unstable_option).
- **Mutating `data` in place** leaves the table on stale rows:
  [`DK_DATA_MUTATED`](../how-to-fix/errors.md#dk_data_mutated).
- **A slow step** (a heavy `format`, a big client search): [`DK_PERF_HINT`](../how-to-fix/errors.md#dk_perf_hint)
  names it; consider server mode or fewer searchable columns.
- **`status: 'pending'` after a big change** is time-sliced work in progress, not a hang; the
  previous rows stay on screen until it finishes.
- **`scheduler.yield` missing** in an older browser falls back to `setTimeout`:
  [`DK_ENV_FALLBACK`](../how-to-fix/errors.md#dk_env_fallback).
- **No bundler replacement for `process.env.NODE_ENV`**: unbundled browser code throws
  `ReferenceError: process is not defined`, and a build that does not set it to `"production"`
  ships the development checks.

## See also

- [Sorting](sorting.md) — the sort algorithms and `sorting({ debug: true })`.
- [Search](search.md) — search weights and typing strategies.
- [Server mode](server-mode.md) — moving filter, search, sort and paging to the server.
- [Entry points](entry-points.md) — what each import path brings.
- [Diagnostics](diagnostics.md) — `explain()`, the tracer and `DK_PERF_HINT`.
- [`@datakable/core` features](../../packages/core/README.md#features)
- [Large data](../examples/large-data.md) — the recipe.
- [Memory and speed with many rows](../how-to-fix/large-data.md) and [the bundle is too
  big](../how-to-fix/bundle-too-big.md) — troubleshooting.
