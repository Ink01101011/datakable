# @datakable/core

The headless, framework-agnostic core of DataKable: a table store, a row pipeline built from
features (column filters, validity, search, sorting, pagination), data modes, schema validation,
diagnostics and `explain()`. No React. For React, use [`datakable`](https://github.com/Ink01101011/datakable/tree/main/packages/datakable) or
[`@datakable/react`](https://github.com/Ink01101011/datakable/tree/main/packages/react).

> Pre-release (`0.x`): the API may still change before 1.0.

```bash
npm install @datakable/core
```

**Bundler requirement:** core reads `process.env.NODE_ENV` directly so bundlers can fold it to a
constant and remove development-only checks, tracing and message text from production builds.
Vite, webpack, Next.js, Rollup (`@rollup/plugin-replace`) and esbuild
(`--define:process.env.NODE_ENV='"production"'`) all replace it. Without a replacement, unbundled
browser code throws `ReferenceError: process is not defined`, as React and Redux do. Node needs
nothing.

## Contents

- [Zero-config](#zero-config)
- [Features](#features)
- [Columns](#columns)
- [Schema validation](#schema-validation)
- [Server mode](#server-mode)
- [Status model](#status-model)
- [Diagnostics](#diagnostics)
- [explain() and explainRow()](#explain-and-explainrow)
- [Table API](#table-api)

## Zero-config

`datakable`'s `createTable({ data })` installs the default preset, derives the columns from the
data (the union of keys over the first 50 rows) and infers the row type:

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

## Features

`@datakable/core`'s own `createTable` installs **no** features, so a bare import stays small. Each
feature has its own entry point, and the table's type contains only the state and methods of the
features you installed:

```ts
import { createTable } from '@datakable/core'
import { pagination } from '@datakable/core/pagination'
import { sorting } from '@datakable/core/sorting'

type User = { id: number; name: string; age: number }
declare const users: User[]

// Only what you install is bundled, in the state, and on the table's type.
const table = createTable({
  data: users,
  features: [sorting(), pagination({ pageSize: 25 })],
})

table.toggleSort('age')
table.nextPage()
// @ts-expect-error search() is not installed, so setSearch does not exist
void table.setSearch
// @ts-expect-error 'nope' is not a path of User
table.toggleSort('nope')
```

| Entry | Feature | State slice | API |
| --- | --- | --- | --- |
| `@datakable/core/column-filters` | `columnFilters({ mode })` | `columnFilters`: one filter per column | `setColumnFilter(id, filter)`, `resetColumnFilters()` |
| `@datakable/core/validity` | `validity()` | `validity`: `'all' \| 'valid' \| 'invalid'` | `setValidity(value)` |
| `@datakable/core/search` | `search({ threshold, fuzzyMaxDistance, caseSensitive, typing, mode, searchFn })` | `search`: `{ input, query, status, error? }` | `setSearch(q)`, `flushSearch()`, `cancelSearch()`, `clearSearch()` |
| `@datakable/core/sorting` | `sorting({ locale, algorithm, debug, mode })` | `sorting`: `{ by: { id, desc }[] }` | `toggleSort(id, { multi })`, `setSorting(by)`, `clearSorting()`, `getSortDirection(id)` |
| `@datakable/core/pagination` | `pagination({ pageSize, autoResetPageIndex, mode })` | `pagination`: `{ pageIndex, pageSize }` | `setPageIndex`, `setPageSize`, `nextPage`, `prevPage`, `getPageCount`, `canNextPage`, `canPrevPage` |

The features are also exported from `@datakable/core` itself. The pipeline always runs
`filter (columnFilters, validity) → search → sort → paginate`, whatever order you list them in.

- **Column filters:** `equals`, `contains` (case-insensitive, NFC-normalised), `in`, `range`
  (number / bigint / Date, inclusive) and `custom` (`fn(value, filterValue, row)`). Filters AND
  together; an array cell matches when any element matches.
- **Search:** fuzzy matching over the formatted cell values. When a column declares
  `search: weight`, only columns with a weight are searched; otherwise every column is, at weight 1. `input` follows the keyboard,
  `query` is the applied value; `typing` sets `immediate` / `debounce` / `throttle`, `wait`,
  `minLength` and `commitOn: 'enter'`. `setSearch` / `flushSearch` return a promise of
  `{ status: 'applied' | 'superseded' | 'error' }` and never reject. A `searchFn` replaces the
  built-in matching (sync or async; the previous results stay while it runs).
- **Sorting:** asc → desc → none; nulls, `NaN` and invalid dates always last; strings with
  `Intl.Collator` (numeric). `algorithm: 'auto'` (default) picks a stable algorithm per sort.
- **Pagination:** `setPageSize` keeps the first visible row on screen; the page index resets when
  search, filters or sort change (`autoResetPageIndex`) and is clamped when rows shrink.

To install the whole preset with core, pass it:

```ts
import { createTable, defaultFeatures } from '@datakable/core'

type User = { id: number; name: string }
declare const users: User[]

// `@datakable/core`'s createTable installs nothing by default. Opt into the preset explicitly:
// [columnFilters(), validity(), search(), sorting(), pagination()]
const table = createTable({ data: users, features: defaultFeatures })
table.toggleSort('name')
```

`defaultFeatures` is one set of instances; `createDefaultFeatures()` returns fresh ones (so tables
do not share a feature's caches). Custom features use the same contract as the built-ins:
`defineFeature({ name, stage, options, initialState, createApi, rowModel, interceptors })`.

## Columns

`columns` is optional. Each column is typed against the row type: `key` is a dot-path of the row
(depth 4), and the column's value type drives `filter`, `cell`, `format` and `sortFn`.

```ts
import { createTable } from '@datakable/core'
import { columnFilters } from '@datakable/core/column-filters'
import { sorting } from '@datakable/core/sorting'

type User = {
  id: number
  name: string
  email: string
  age: number
  joined: Date
  address: { city: string; zip: string }
  manager: { name: string } | null
}
declare const users: User[]

const table = createTable({
  data: users,
  rowKey: 'id',
  features: [columnFilters(), sorting()],
  columns: [
    { key: 'name', header: 'Name', search: 1 }, // search weight
    { key: 'age', filter: { type: 'range' } },
    { key: 'joined', sortAlgorithm: 'native' },
    { key: 'address.city', search: 0.5 }, // dot-paths, typed against User
    { key: 'manager.name' }, // nullable parents are fine
    { key: 'address', format: (a) => `${a.city} ${a.zip}` }, // objects need format or cell
    { key: 'email', sensitive: true }, // never written to diagnostics
    { id: 'label', accessor: (u) => `${u.name} (${u.age})` }, // derived column
  ],
})

table.setColumnFilter('age', { type: 'range', value: { min: 18, max: 65 } })
// @ts-expect-error 'range' needs a number / bigint / Date column
table.setColumnFilter('name', { type: 'range', value: { min: 1 } })
```

Other column fields: `cell` (custom render; `R` is `ReactNode` in React), `sortable`, `sortFn`,
`sortBy`, `invalidCell`. Values without a renderer go through the default formatter (`null` →
`''`, dates `toLocaleString()`, arrays of primitives joined). [Reading type errors](https://github.com/Ink01101011/datakable/blob/main/docs/reading-type-errors.md)
explains the compile errors these rules produce.

## Schema validation

Pass any [Standard Schema](https://standardschema.dev) (zod, valibot, arktype, …) wrapped with
`withSchema()` from `@datakable/core/schema`, and the row type is its output. Validation is an
opt-in import, so a table without a schema does not bundle it:

```ts
import { createTable, type StandardSchemaV1 } from '@datakable/core'
import { withSchema } from '@datakable/core/schema'
import { validity } from '@datakable/core/validity'

type User = { id: number; name: string }
// Any Standard Schema v1: zod, valibot, arktype, …  e.g. z.object({ id: z.number(), … })
declare const UserSchema: StandardSchemaV1<unknown, User>
declare const json: unknown[] // e.g. await res.json()

const table = createTable({
  data: json, // raw input: every row is validated
  schema: withSchema(UserSchema), // opt-in validation; the row type is the schema's output
  invalidRows: 'flag', // 'drop' (default) | 'flag' | 'throw'
  rowKey: 'id',
  features: [validity()], // filters 'all' | 'valid' | 'invalid'
})

for (const row of table.getRowModel().rows) {
  if (row.valid) {
    console.log(row.original.name) // narrowed: original is a User
  } else {
    console.warn(row.issues, row.getCellIssues('name')) // original is unknown
  }
}
table.setValidity('invalid') // only the flagged rows
console.log(table.getInvalidRows()) // [{ index, raw, issues }] in every mode
```

`invalidRows: 'drop'` (default) removes invalid rows, `'flag'` keeps them as rows with
`valid: false`, and `'throw'` throws `DatakableSchemaError`. Every mode reports
`DK_SCHEMA_INVALID_ROW` and lists the rows in `getInvalidRows()`. An async schema sets
`status: 'validating'` while it runs.

## Server mode

Every pipeline feature takes `mode: 'client' | 'server'`. Server steps must form a prefix of the
pipeline (server filter + search, then client sort + paginate is fine; server paginate before
client search is not) — a violation throws `DatakableConfigError` (`DK_MODE_ORDER`) at creation
(a development check).

With a `fetcher`, the table loads its own data. The server source is an opt-in import: wrap the
fetcher with `withFetcher()` from `@datakable/core/server`, so a table without one does not bundle
it:

```ts
import { createTable, type FetchResult } from '@datakable/core'
import { pagination } from '@datakable/core/pagination'
import { search } from '@datakable/core/search'
import { withFetcher } from '@datakable/core/server'
import { sorting } from '@datakable/core/sorting'

type User = { id: number; name: string }

const table = createTable({
  rowKey: 'id',
  // Server steps must come first in the pipeline (filter → search → sort → paginate);
  // client steps may follow them. Search typing defaults to a 300 ms debounce in server mode.
  features: [
    search({ mode: 'server' }),
    sorting({ mode: 'server' }),
    pagination({ mode: 'server', pageSize: 20 }),
  ],
  // Receives only the server-mode state. Latest request wins; superseded ones are aborted.
  fetcher: withFetcher(async ({ query, sort, pageIndex, pageSize, signal }) => {
    const params = new URLSearchParams({
      q: query ?? '',
      sort: (sort ?? []).map((s) => `${s.desc ? '-' : ''}${s.id}`).join(','),
      page: String(pageIndex),
      size: String(pageSize),
    })
    const res = await fetch(`/api/users?${params}`, { signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as FetchResult<User> // { rows, rowCount }
  }),
  timeout: 10_000, // default 30 s → DK_ASYNC_TIMEOUT
})

// A failed request keeps the previous rows, sets status 'error' and reports DK_FETCH_FAILED.
// Retry with the current params; like setSearch, it never rejects.
const { status } = await table.refetch() // 'applied' | 'superseded' | 'error'
console.log(status)
```

- The fetcher receives only the state of the server-mode features (`query`, `filters`, `sort`,
  `pageIndex`, `pageSize`) and a `signal`. It runs at creation and whenever that state changes.
- Requests go through one async control: latest wins, superseded requests are aborted, `timeout`
  applies, and the result is validated (`DK_FETCH_BAD_RESPONSE` for a missing `rows`, or
  `rowCount < rows.length`). Returned rows go through `schema` and the data checks.
- A failure (`DK_FETCH_FAILED`, `DK_ASYNC_TIMEOUT`) keeps the previous rows and sets
  `status: 'error'`. `refetch()` retries with the current params; it never rejects.
- A `fetcher` without any server-mode feature throws `DK_FETCHER_WITHOUT_SERVER_MODE`.

Without a fetcher, core only holds the server-mode state and you pass each page in:

```ts
import { createTable } from '@datakable/core'
import { pagination } from '@datakable/core/pagination'

type User = { id: number; name: string }
declare const page: User[] // the rows of the current page, fetched by the app
declare const total: number

// Server mode without a fetcher: core only holds the state; the app fetches.
const table = createTable({
  data: page,
  rowCount: total, // without it: DK_ROW_COUNT_MISSING
  features: [pagination({ mode: 'server' })],
})

table.subscribe((state) => {
  // fetch page state.pagination.pageIndex, then:
  // table.setOptions({ data: nextPage, rowCount: nextTotal })
  console.log(state.pagination)
})
```

## Status model

`getRowModel()` returns `{ rows, filteredCount, totalCount, status, isInitialLoad }`. `rows` holds
the visible page only; `filteredCount` counts the rows after filter and search; `totalCount` the
rows after ingest.

| `status` | Meaning |
| --- | --- |
| `'idle'` | the row model is current |
| `'validating'` | an async schema is running |
| `'pending'` | a search debounce is waiting, time-sliced work (search index, string sort over large data) is running, or async work waits for the client after SSR (`createDeferred`) |
| `'searching'` | an async `searchFn` request is in flight |
| `'fetching'` | a `fetcher` request is in flight (initial load, or a page / sort / filter / query change in server mode) |
| `'error'` | a diagnostic affected the row model; the last good row model is shown |

When activities overlap, the most specific one wins: `error` > `fetching` > `searching` >
`validating` > `pending` > `idle`. So a `refetch()` after a failed fetch keeps `status: 'error'`
until a request applies; await the promise `refetch()` returns to follow the retry. A cell-level
problem handled inside a step (a throwing `format`, `DK_FILTER_TYPE_MISMATCH`) is reported as a
diagnostic and leaves the status as it was.

`isInitialLoad` is `true` until the table has had rows to show for the first time (data given at
creation, or the first fetcher / `searchFn` result applied). It never goes back to `true`, and an
empty result counts as loaded. If the first request fails, `status` is `'error'` while
`isInitialLoad` stays `true`.

**Status is never silent:** every change of `status` or `isInitialLoad` produces a new row model
and notifies subscribers, so a UI bound to `getRowModel()` always shows what the table is doing.

```ts
import type { RowModel } from '@datakable/core'

// What to show for a row model (§6.6). A change of `status` or `isInitialLoad` always produces a
// new row model and notifies subscribers: status is never silent.
export function view<T>(model: RowModel<T>) {
  const { status, isInitialLoad, rows } = model
  // Before the first rows, 'pending' is a load waiting to start (e.g. deferred to the client, §7.2).
  const busy = status !== 'idle' && status !== 'error'
  if (isInitialLoad && busy) return 'loading' // nothing to show yet
  if (isInitialLoad && status === 'error') return 'error' // the first request failed
  if (rows.length === 0 && status === 'idle') return 'empty' // loaded, zero rows
  // Otherwise show the rows: during 'pending' / 'searching' / 'fetching' / 'validating' they are
  // the previous results (add a refresh indicator); on 'error' they are the last good rows.
  return status === 'idle' ? 'rows' : `rows+${status}`
}
```

## Diagnostics

Every problem the table detects is a `Diagnostic`: a stable `code` (`DK_*`, public API, never
reused), `level`, `problem`, `where` (column, feature, option or row), `impact` (what the table did
instead), `fix` (computed from your data, best first), `docs`, redacted `details`, a `context`
(table name, trigger, pipeline run, phase) and a `fingerprint` for grouping. Data and runtime
problems never throw: the table falls back to the last good state. Configuration mistakes (for
example `DK_MODE_ORDER`, an invalid option) throw `DatakableConfigError` at creation.

```ts
import { createTable, type Diagnostic } from '@datakable/core'

type User = { id: number; name: string; ssn: string }
declare const users: User[]
declare const Sentry: { captureMessage(message: string, context: object): void }

const table = createTable({
  name: 'UsersTable', // shown in every diagnostic
  data: users,
  rowKey: 'id',
  columns: [{ key: 'name' }, { key: 'ssn', sensitive: true }],
  diagnostics: { redact: 'safe' }, // 'safe' (prod default) | 'keys' (dev default) | 'full' | fn
  onDiagnostic: (d: Diagnostic) => {
    // code, level, where, problem, impact, fix[], docs, context, fingerprint
    if (d.level === 'error') Sentry.captureMessage(d.code, d.toJSON())
  },
  strict: false, // true: error-level diagnostics throw DatakableError
})

for (const d of table.getDiagnostics()) console.log(d.code, d.where, d.fix)
```

- **Sinks:** `onDiagnostic` receives every diagnostic. The default console sink prints one
  collapsed group per diagnostic in development and only `error` level, on one line, in
  production. `getDiagnostics()` keeps the last 100. Repeats of the same code and location are
  aggregated (`context.occurrences`) and the console is rate-limited.
- **Redaction** (`diagnostics.redact`): `'safe'` logs paths, indices, counts, value types and
  hashed row keys (production default); `'keys'` adds raw row keys (development default); `'full'`
  adds row values. A custom `redact(path, value)` can rewrite any field. Columns with
  `sensitive: true` are never logged at any level, and fetcher errors are logged by name only (the
  original goes to `onDiagnostic` as `context.cause`).
- **Production text:** production builds keep `code`, `where`, `context` and a docs URL and drop
  the `problem` / `impact` / `fix` text. To keep it:

```ts
// Production builds keep code, where, context and a docs URL; the text is stripped. Import once
// in the app entry to keep the full problem / impact / fix text in production:
import '@datakable/core/messages'
```

## explain() and explainRow()

Both work in the browser console, in tests and on the server, and go through the same redaction as
diagnostics:

```ts
import { createTable, defaultFeatures } from '@datakable/core'

type Product = { sku: string; name: string; price: number }
declare const products: Product[]

const table = createTable({ data: products, rowKey: 'sku', features: defaultFeatures })
table.setColumnFilter('price', { type: 'range', value: { min: 100 } })
await table.setSearch('chair')

// Where did my rows go? Rows per step, the page, timings (traced in development).
console.log(String(table.explain()))

// Why is this row not shown? Replays one row through every step.
const why = table.explainRow('SKU-042')
console.log(why.visible, why.removedBy, String(why))
```

```text
run 2 1.1 ms · trigger api:setSearch · 300 rows → columnFilters 200 cached → validity 200 cached → search 28 1.1 ms → sorting 28 0.0 ms → page 1/3 (10) · status idle · 0 open diagnostics

row SKU-042 · data index 42 · run 2
  – schema        no schema
  ✗ columnFilters price range object → number fails   ← removed here
  · validity      not reached
  · search        not reached
  · sorting       not reached
  · pagination    not reached
  fix             setColumnFilter('price', undefined) or resetColumnFilters()
```

`explain()` returns the last pipeline run (rows per step, schema drops, the page, open diagnostics,
timings when traced); `explainRow(key)` replays one row through the schema and every step and
names the step that removed it. Both are plain objects; `String(…)` gives the report above.

## Table API

| Method | |
| --- | --- |
| `getState()` / `setState(updater)` / `subscribe(listener)` | immutable snapshots; one throwing listener never stops the others |
| `getRowModel()` | rows, counts, `status`, `isInitialLoad` |
| `setOptions(partial)` / `getOptions()` | update `data`, `columns`, `state`, `fetcher`, `rowCount`, … |
| `getData()` / `getInvalidRows()` | ingested data; rows that failed `schema` |
| `getDiagnostics()` | the last 100 diagnostics |
| `explain()` / `explainRow(key)` | why the rows are what they are |
| `refetch()` | re-run the fetcher; never rejects |
| `destroy()` | release listeners; later calls are no-ops (`DK_TABLE_DESTROYED`) |

Options: `data`, `columns`, `rowKey` (a path or `(row) => string | number`; duplicates and missing
keys are reported and get fallback keys), `features`, `schema` (`withSchema`, from
`@datakable/core/schema`), `invalidRows`, `initialState`, controlled `state` + `onStateChange`,
`interceptors`, `fetcher` (`withFetcher`, from `@datakable/core/server`), `rowCount`, `timeout`,
`name`, `onDiagnostic`, `strict`, `diagnostics`. In development, unknown options are reported with a
did-you-mean and invalid values throw `DatakableConfigError` naming the accepted values; production
builds skip these checks (like the data checks and version checks) to stay small.

## License

MIT
