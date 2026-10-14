# Core concepts

This page explains the pieces every other guide refers to: the table object `createTable` returns,
the pipeline that turns your data into rows, the row model with its `status` and
`isInitialLoad`, the `Row` objects, how options are updated, and what happens when something goes
wrong. It ends with the full list of `createTable` options.

## The table

`createTable(options)` returns a table: a store that holds your data and state, and computes the
rows to show. `useDataTable` creates the same table inside a React component, and `<DataTable />`
renders one. Everything below applies to all three.

The table has its own methods, plus the methods of every installed feature merged onto it
(`toggleSort`, `setSearch`, `nextPage`, …; see [Features](features.md)).

| Method | Description |
| --- | --- |
| `getState()` | The current state snapshot: one slice per feature. Immutable; the same reference until a slice changes. See [State](state.md). |
| `setState(updater)` | Merges a partial state, or the result of `(prev) => partial`, slice by slice. |
| `subscribe(listener)` | Calls `listener(state, prev)` after every committed change; returns the unsubscribe function. |
| `getRowModel()` | The rows to show, the counts and the status (below). |
| `setOptions(partial)` | Merges new options: `data`, `columns`, `rowKey`, `state`, `fetcher`, `rowCount`, … |
| `getOptions()` | The current options. |
| `getData()` | The ingested data (the previous data while an async schema runs or after a failed ingest). |
| `getInvalidRows()` | The rows that failed the schema: `{ index, raw, issues }[]`. See [Schema validation](schema-validation.md). |
| `getDiagnostics()` | The last 100 diagnostics, oldest first. See [Diagnostics](diagnostics.md). |
| `explain()` / `explainRow(key)` | Why the rows are what they are: rows per step, or one row replayed through every step. |
| `refetch()` | Runs the `fetcher` again; resolves `{ status }` and never rejects. See [Server mode](server-mode.md). |
| `destroy()` | Releases listeners and timers. Later calls are no-ops. |

```ts
import { createTable } from 'datakable'

type User = { id: number; name: string; address: { city: string } }

const users: User[] = [
  { id: 7, name: 'Mali', address: { city: 'Bangkok' } },
  { id: 9, name: 'Anan', address: { city: 'Chiang Mai' } },
]

const table = createTable({
  data: users,
  rowKey: 'id',
  columns: [{ key: 'name' }, { key: 'address.city' }],
})

const model = table.getRowModel()
// The same object until data, state or columns change the result.
console.log(model === table.getRowModel()) // true
console.log(model.filteredCount, model.totalCount, model.status, model.isInitialLoad) // 2 2 'idle' false

for (const row of model.rows) {
  // key: the rowKey value · index: position in the data · original: the row object as passed
  console.log(row.key, row.index, row.original.name, row.getValue('address.city'))
}
```

## The pipeline

Your data goes through a fixed sequence of steps. Each feature runs at its stage, whatever order you
list the features in:

```
ingest → filter (columnFilters, validity) → search → sort → paginate
```

- **Ingest** reads `data`: it resolves row keys (`rowKey`), validates rows against a `schema` when
  you give one, and in development checks the data against your columns (missing paths, mutated
  arrays, inconsistent row shapes).
- **Filter** runs before search because fuzzy search is the most expensive step; the resulting set
  is the same in either order.
- **Sort** orders what is left. With no sort, search results keep their relevance order.
- **Paginate** cuts out the current page.

Steps work on arrays of row indices, never on copies of your rows, and each step is memoised on its
input and its own state slice: typing in the search box does not re-run the filters, and changing
the page does not re-sort. Column values are read once per data array and column. `Row` objects
are created only for the rows of the current page, and only when you read them.

A feature can also run in **server mode** (`mode: 'server'`): the step is skipped in the browser and
its state goes to your server instead. See [Server mode](server-mode.md).

## The row model

`getRowModel()` returns the result of the pipeline (`table.rowModel` in React). It is the same
object until data, state or columns change the result, so you can compare it by reference.

| Field | Type | Description |
| --- | --- | --- |
| `rows` | `readonly Row<T>[]` | The visible rows only: the current page when paginated. |
| `filteredCount` | `number` | Rows left after filter and search, before pagination. In server mode, the rows the table holds (the page the server returned), not the server's total: that is the fetcher result's `rowCount` ([Server mode](server-mode.md#counting-rows-in-server-mode)). |
| `totalCount` | `number` | Rows after ingest (after a schema dropped invalid rows). In server mode, the page the server returned. |
| `status` | `RowModelStatus` | What the table is doing (below). |
| `isInitialLoad` | `boolean` | `true` until the table has had rows to show once. |

### Rows

Each row in `rows` is a `Row`:

| Member | Type | Description |
| --- | --- | --- |
| `key` | `string \| number` | The row's `rowKey` value; the row index without `rowKey`; a fallback key (`42#1`, `#5`) for a duplicate or missing key. |
| `index` | `number` | Position in the ingested data (`getData()`). |
| `original` | `T` | The row object as you passed it. |
| `valid` | `boolean` | `false` for a row flagged by schema validation (`invalidRows: 'flag'`). |
| `issues` | `readonly RowIssue[]` | The row's schema issues; empty for a valid row. |
| `getValue(id)` | `unknown` | The value of column `id` (its key path or accessor). Never throws. |
| `getCellIssues(id)` | `readonly RowIssue[]` | The schema issues that point into column `id`. |

With `invalidRows: 'flag'`, `rows` is a union: narrow on `row.valid` before reading
`row.original` as `T` ([Schema validation](schema-validation.md)).

### Status

`status` says what the table is doing, so the UI can always show it:

| `status` | Meaning |
| --- | --- |
| `'idle'` | The row model is current. |
| `'validating'` | An async schema is running. |
| `'pending'` | A search debounce is waiting, time-sliced work (the search index, a string sort over large data) is running, or async work waits for the browser after server rendering. |
| `'searching'` | An async `searchFn` request is in flight. |
| `'fetching'` | A `fetcher` request is in flight. |
| `'error'` | Something affected the row model; the last good rows are still shown. |

When activities overlap, the most specific wins: `error` > `fetching` > `searching` >
`validating` > `pending` > `idle`. A problem handled inside a step for one cell (a `format` that
throws, a filter on a value of the wrong type) is reported as a diagnostic and does not set
`'error'`.

`isInitialLoad` is `true` until the table has had rows to show for the first time: data given at
creation, `initialData`, or the first `fetcher` / `searchFn` result. An empty result counts as
loaded. It never goes back to `true`. Together they separate the states a UI needs:

- `isInitialLoad` and busy (`'fetching'`, `'searching'`, `'validating'`, `'pending'`): a full
  loading state; there is nothing to show yet.
- `isInitialLoad` and `'error'`: the first load failed.
- not `isInitialLoad` and busy: show the rows (the previous results) with a refresh indicator.
- not `isInitialLoad` and `'error'`: show the last good rows with an error message.

**Status is never silent:** every change of `status` or `isInitialLoad` produces a new row model
and notifies subscribers.

```ts
import { createTable, type RowModel } from 'datakable'

type User = { id: number; name: string }
declare const users: User[]
declare function render(html: string): void

/** What to show for a row model: every status / isInitialLoad combination. */
function view(model: RowModel<User>): string {
  const { status, isInitialLoad, rows } = model
  const busy = status !== 'idle' && status !== 'error'
  if (isInitialLoad && busy) return 'Loading…' // nothing to show yet
  if (isInitialLoad && status === 'error') return 'Could not load.' // the first load failed
  if (rows.length === 0 && status === 'idle') return 'No users.' // loaded, zero rows
  const list = rows.map((row) => row.original.name).join(', ')
  // Rows are on screen; when busy or failed they are the previous (last good) ones.
  return status === 'idle' ? list : `${list} (${status === 'error' ? 'stale' : 'updating…'})`
}

const table = createTable({ data: users, rowKey: 'id' })
render(view(table.getRowModel()))
// Every change of status or isInitialLoad notifies: the view never misses one.
table.subscribe(() => render(view(table.getRowModel())))
```

`<DataTable />` implements exactly this logic with its Loading, Error and Empty parts and a
refresh indicator ([React](react.md)).

## Updating options

`setOptions(partial)` merges new options into the current ones. Pass a **new array** to change the
data: the table compares `data` and `columns` by reference, ingests the new data, keeps its state
(sort, filters, search query, page) and notifies once.

```ts
import { createTable } from 'datakable'

type User = { id: number; name: string }
declare const firstLoad: User[]
declare const reloaded: User[]

const table = createTable({ name: 'UsersTable', data: firstLoad, rowKey: 'id' })

// New data: pass a new array. The table ingests it, keeps its state (sort, filters, search) and
// notifies subscribers once.
table.setOptions({ data: reloaded })

// Read-once options keep the value they were created with; development builds report the
// attempt as DK_OPTION_NO_EFFECT.
table.setOptions({ name: 'Renamed' })
console.log(table.getOptions().name) // 'UsersTable'
```

Some options are **read once**, at creation: `name`, `schema`, `invalidRows`, `features`,
`initialState`, `timeout`, `initialData`, `strict` and `diagnostics`. To change one, create a new
table (in React, change the component's `key`). `features` cannot be passed to `setOptions` at
all.

Mutating the array you passed (`users.push(…)`) is not a change the table can see; development
builds report it as [`DK_DATA_MUTATED`](../how-to-fix/errors.md#dk_data_mutated).

## When something goes wrong

DataKable never fails silently. There are two kinds of problems:

- **Configuration mistakes** throw a `DatakableConfigError` when the table is created (or on
  `setOptions`): an option of the wrong type or range, two features with the same name, a server
  step after a client step, a `fetcher` without a server-mode feature. The error carries the same fields as a diagnostic: `code`, `where`,
  `fix`, `docs`. Development builds check every option; production builds skip most of these
  checks to stay small, but still refuse an unwrapped `schema`, `fetcher` or `searchFn`.
- **Data and runtime problems never throw.** A duplicate row key, a row that fails the schema, a
  `format` that throws, a failed request: each becomes a diagnostic with a stable `DK_*` code, and
  the table applies a defined fallback (a fallback key, the previous rows, an empty cell) and keeps
  working. With `strict: true`, error-level diagnostics throw a `DatakableError` instead.

```ts
import { createTable, DatakableConfigError } from 'datakable'

type User = { id: number; name: string }
declare const users: User[]

try {
  // A configuration mistake throws at creation (development builds check every option): here, a
  // timeout that is not > 0.
  createTable({ data: users, timeout: -1 })
} catch (e) {
  if (e instanceof DatakableConfigError) {
    console.error(e.code, e.where, e.fix) // 'DK_INVALID_OPTION', { kind: 'option', … }, [ … ]
  }
}
```

Diagnostics print to the console in development and reach `onDiagnostic`; see
[Diagnostics](diagnostics.md). `explain()` and `explainRow(key)` answer "where did my rows go?"
when nothing is wrong but the result still surprises you.

## Destroying a table

`destroy()` releases the table's listeners, timers and in-flight requests. `useDataTable` and
`<DataTable />` call it when the component unmounts; with `createTable`, call it yourself.

```ts
import { createTable } from 'datakable'

type User = { id: number; name: string }
declare const users: User[]

const table = createTable({ data: users, rowKey: 'id' })
const unsubscribe = table.subscribe((state) => console.log(state.pagination.pageIndex))

// When the table is no longer needed (a React component unmounting does this for you):
unsubscribe()
table.destroy()

// Later calls are no-ops that report DK_TABLE_DESTROYED; promise methods still resolve.
const { status } = await table.setSearch('mali')
console.log(status) // 'superseded'
```

## Options

Every option of `createTable` (the same for `useDataTable` and `<DataTable />` props). "Read once"
options keep their first value; the others can change through `setOptions` (in React, by passing
a new prop).

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `data` | `readonly T[]` | `[]` | The rows. The row type `T` is inferred from it. With a `schema`, raw `unknown[]` input. |
| `columns` | `readonly ColumnDef<T>[]` | derived from the data | The columns. See [Columns and row keys](columns-and-row-keys.md). |
| `rowKey` | `Path<T> \| ((row: T) => string \| number)` | the row index | Row identity. See [Columns and row keys](columns-and-row-keys.md#row-keys). |
| `features` | `readonly AnyFeature[]` | the default preset (`datakable`); none (`@datakable/core`, `@datakable/react`) | The installed features. Read once. See [Features](features.md). |
| `initialState` | `Partial<S>` | each feature's initial state | Starting values of state slices. Read once. See [State](state.md). |
| `state` | `ControlledState<S>` | — | Slices you own (controlled state). See [State](state.md#controlled-state). |
| `onStateChange` | `(updater: (prev: Partial<S>) => Partial<S>) => void` | — | Receives changes to controlled slices. |
| `schema` | `TableSchema` (from `withSchema(schema)`) | — | Validates every row; the row type is its output. Read once. See [Schema validation](schema-validation.md). |
| `invalidRows` | `'drop' \| 'flag' \| 'throw'` | `'drop'` | What happens to rows that fail the schema. Read once. |
| `fetcher` | `ServerFetcher<T>` (from `withFetcher(fn)`) | — | Loads rows from your server. See [Server mode](server-mode.md). |
| `rowCount` | `number` | — | Server mode without a fetcher: the total number of rows on the server. |
| `initialData` | `readonly T[]` | — | SSR: rows the server already produced; used when `data` is not given. Read once. See [Server rendering (SSR)](ssr.md). |
| `timeout` | `number` (ms) | `30000` | Abort a `fetcher` / `searchFn` request after this long (`DK_ASYNC_TIMEOUT`); `Infinity` disables it. Read once. |
| `interceptors` | `readonly Interceptor[]` | — | Hooks around the table's operations. See [Custom features and interceptors](custom-features-and-interceptors.md). |
| `onDiagnostic` | `(d: Diagnostic) => void` | — | Receives each diagnostic, repeats aggregated (e.g. to send to Sentry). |
| `diagnostics` | `{ redact?: RedactLevel \| RedactFn }` | `'keys'` in development, `'safe'` in production | What diagnostics may log. Read once. See [Diagnostics](diagnostics.md). |
| `strict` | `boolean` | `false` | Throw error-level diagnostics as `DatakableError`. Read once. |
| `name` | `string` | `table#n` | Names the table in diagnostics. Read once. |

In development, an unknown option is reported with a did-you-mean
([`DK_UNKNOWN_OPTION`](../how-to-fix/errors.md#dk_unknown_option)), and a value of the wrong type or range
throws ([`DK_INVALID_OPTION`](../how-to-fix/errors.md#dk_invalid_option)) naming the accepted values.

## Pitfalls

- **Mutating `data` in place** — the same array reference means "no change". Pass a new array;
  development builds report [`DK_DATA_MUTATED`](../how-to-fix/errors.md#dk_data_mutated).
- **Changing a read-once option** with `setOptions` (or a new prop in React) is ignored and
  reported as [`DK_OPTION_NO_EFFECT`](../how-to-fix/errors.md#dk_option_no_effect). Create a new table
  instead.
- **Using a table after `destroy()`** — calls are no-ops that report
  [`DK_TABLE_DESTROYED`](../how-to-fix/errors.md#dk_table_destroyed). Unsubscribe and cancel timers in your
  cleanup.
- **Treating `status: 'error'` as "no rows"** — the rows on screen are the last good ones. Only
  `isInitialLoad && status === 'error'` means nothing could be shown.
- **Reading `rows` as all rows** — it is the current page. Use `filteredCount` for the number of
  matching rows and `getData()` for all ingested rows. In server mode both count the page: the
  number of matching rows is the server's `rowCount`
  ([Server mode](server-mode.md#counting-rows-in-server-mode)).

## See also

- [State](state.md) — snapshots, listeners and controlled slices.
- [Features](features.md) — the methods features add to the table.
- [Diagnostics](diagnostics.md) — sinks, redaction and `explain()`.
- [`@datakable/core` README](../../packages/core/README.md#table-api) — the table API reference.
- [The table shows no rows](../how-to-fix/no-rows.md) — reading the row model when rows go missing.
