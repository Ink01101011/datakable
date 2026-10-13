# Features

Everything a table does beyond holding data — filtering, search, sorting, pagination, the validity
filter — is a feature you install. This page covers the default preset, how to choose your own
features, the order the pipeline runs them in, and where each one is imported from. Each feature
has its own page for its options and API.

## The default preset

`datakable`'s `createTable`, `useDataTable` and `<DataTable />` install the default preset when you
pass no `features`: `columnFilters()`, `validity()`, `search()`, `sorting()` and `pagination()`.
Each table (each component instance in React) gets fresh instances of them.

```ts
import { createTable } from 'datakable'

type User = { id: number; name: string; age: number }
declare const users: User[]

// No `features`: `datakable` installs the default preset, fresh instances per table.
const table = createTable({ data: users, rowKey: 'id' })

table.setColumnFilter('age', { type: 'range', value: { min: 18 } }) // columnFilters()
table.setValidity('all') // validity()
await table.setSearch('ada') // search()
table.toggleSort('name') // sorting()
table.nextPage() // pagination()
```

`@datakable/core`'s `createTable` (also `datakable/core`) and `@datakable/react`'s `useDataTable`
install **no** features unless you pass them, so a bare import stays small.

## Choosing features

Passing `features` replaces the preset entirely. Only the features you install are bundled, have
a slice in the state and have methods on the table — the table's type follows the list, so using
a feature you did not install is a compile error.

```ts
import { createTable } from '@datakable/core'
import { pagination } from '@datakable/core/pagination'
import { sorting } from '@datakable/core/sorting'

type User = { id: number; name: string; age: number }
declare const users: User[]

// `features` replaces the preset: only these two are installed, bundled and typed.
const table = createTable({
  data: users,
  rowKey: 'id',
  features: [sorting(), pagination({ pageSize: 25 })],
})

table.toggleSort('age')
console.log(table.getState().pagination.pageSize) // 25

// @ts-expect-error search() is not installed: no setSearch method
void table.setSearch
// @ts-expect-error nor a search slice in the state
void table.getState().search
```

To install the whole preset with core, pass `defaultFeatures` (one shared set of instances) or
`createDefaultFeatures()` (a fresh set per call). A feature instance keeps caches (the search
index, sort caches), so give each table its own instances when you create several:

```ts
import { createDefaultFeatures, createTable, defaultFeatures } from '@datakable/core'

type User = { id: number; name: string }
declare const users: User[]
declare const admins: User[]

// One table: the shared `defaultFeatures` instances are fine.
const single = createTable({ data: users, features: defaultFeatures })

// Several tables: give each its own instances, so they do not share a feature's caches.
const left = createTable({ data: users, features: createDefaultFeatures() })
const right = createTable({ data: admins, features: createDefaultFeatures() })

single.toggleSort('name')
left.toggleSort('name')
right.toggleSort('name')
```

`features` is read once, at creation: `setOptions({ features })` has no effect, and in React a new
inline array on each render does not recreate the table.

## Pipeline order

Each feature declares a `stage`, and the pipeline runs the stages in a fixed order, whatever order
you list the features in:

`ingest → filter (columnFilters, validity) → search → sort → paginate`

Filters run before search because fuzzy matching is the most expensive step; the result set is the
same either way. Each step works on row indices and is memoised on its input and its own state
slice, so changing the page does not filter, search or sort again.

```ts
import { createTable } from '@datakable/core'
import { columnFilters } from '@datakable/core/column-filters'
import { pagination } from '@datakable/core/pagination'
import { search } from '@datakable/core/search'
import { sorting } from '@datakable/core/sorting'

type User = { id: number; name: string; city: string }
declare const users: User[]

// Listed in any order, run by stage: filter → search → sort → paginate.
const table = createTable({
  data: users,
  features: [pagination(), sorting(), search(), columnFilters()],
})

table.setColumnFilter('city', { type: 'equals', value: 'Bangkok' })
await table.setSearch('mal') // searches the filtered rows only
table.toggleSort('name') // sorts the search results
console.log(table.getRowModel().rows) // the first page of the sorted results
```

## The built-in features

| Entry | Factory and options | State slice | API |
| --- | --- | --- | --- |
| `@datakable/core/column-filters` | `columnFilters({ mode })` | `columnFilters`: one filter per column | `setColumnFilter(id, filter)`, `resetColumnFilters()` |
| `@datakable/core/validity` | `validity()` | `validity`: `'all' \| 'valid' \| 'invalid'` | `setValidity(value)` |
| `@datakable/core/search` | `search({ threshold, fuzzyMaxDistance, caseSensitive, typing, mode, searchFn })` | `search`: `{ input, query, status, error? }` | `setSearch(query)`, `flushSearch()`, `cancelSearch()`, `clearSearch()` |
| `@datakable/core/sorting` | `sorting({ locale, algorithm, debug, mode })` | `sorting`: `{ by: { id, desc }[] }` | `toggleSort(id, { multi })`, `setSorting(by)`, `clearSorting()`, `getSortDirection(id)` |
| `@datakable/core/pagination` | `pagination({ pageSize, autoResetPageIndex, mode })` | `pagination`: `{ pageIndex, pageSize }` | `setPageIndex(index)`, `setPageSize(size)`, `nextPage()`, `prevPage()`, `getPageCount()`, `canNextPage()`, `canPrevPage()` |

All five are also exported from `@datakable/core` and `datakable`; the per-feature entries let a
bundler keep only what you import. The feature pages document every option:
[column filters](column-filters.md), [validity](validity.md), [search](search.md),
[sorting](sorting.md), [pagination](pagination.md).

Feature options are checked at `createTable` in development: an unknown option is reported with a
did-you-mean (`DK_UNKNOWN_OPTION`), an invalid value throws `DatakableConfigError`
(`DK_INVALID_OPTION`), and an option that does nothing in its configuration is reported as
`DK_OPTION_NO_EFFECT`. Production builds skip these checks.

## Data modes

Every pipeline feature takes `mode: 'client' | 'server'` (default `'client'`). A server-mode feature
only holds its state: core skips its step, and the state goes to the `fetcher` (or your app fetches
with it). Server steps must come first in the pipeline — server filter and search followed by
client sort and paginate is fine, server paginate followed by client search is not (the client
would only see one page). [Server mode](server-mode.md) covers the fetcher, `rowCount` and the
async statuses.

## Writing your own

Third-party features use the same contract as the built-ins: `defineFeature({ name, stage,
options, initialState, createApi, rowModel, interceptors })`. See
[Custom features and interceptors](custom-features-and-interceptors.md).

## Pitfalls

- **Two features with the same name**, or two that expose the same method, throw at creation:
  [`DK_FEATURE_DUPLICATE`](../errors.md#dk_feature_duplicate),
  [`DK_FEATURE_API_CONFLICT`](../errors.md#dk_feature_api_conflict).
- **A client step before a server step** throws
  [`DK_MODE_ORDER`](../errors.md#dk_mode_order) (a development check).
- **Changing `features` after creation** does nothing; in development `setOptions` reports
  [`DK_OPTION_NO_EFFECT`](../errors.md#dk_option_no_effect). Create a new table instead (in React,
  remount the component with a new `key`).
- **A misspelt or invalid feature option** is
  [`DK_UNKNOWN_OPTION`](../errors.md#dk_unknown_option) /
  [`DK_INVALID_OPTION`](../errors.md#dk_invalid_option).

## See also

- [Core concepts](core-concepts.md) — the table, the pipeline and the row model.
- [State](state.md) — the feature slices in the table state.
- [Entry points](entry-points.md) — every import path.
- [`@datakable/core` features](../../packages/core/README.md#features)
- [Examples](../examples/README.md)
