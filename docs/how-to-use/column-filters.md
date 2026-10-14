# Column filters

`columnFilters()` keeps the rows whose cells match a filter per column: equality, substring, set
membership, numeric or date ranges, or your own predicate. This page covers the filter kinds, which
kinds each value type allows, how filters combine, and what happens with empty inputs, `null` cells
and values of the wrong type.

## Setting filters

Install `columnFilters()` (it is in the default preset of `datakable`), then set one filter per
column with `setColumnFilter(id, filter)`. `id` is a key path of the row type, and the filter is
typed by that column's value type.

```ts
import { createTable } from '@datakable/core'
import { columnFilters } from '@datakable/core/column-filters'

type User = {
  id: number
  name: string
  city: string
  age: number
  active: boolean
  joined: Date
  tags: string[]
}
declare const users: User[]

const table = createTable({ data: users, rowKey: 'id', features: [columnFilters()] })

// Each call sets one column's filter; filters on different columns combine with AND.
table.setColumnFilter('active', { type: 'equals', value: true })
table.setColumnFilter('name', { type: 'contains', value: 'mal' }) // case-insensitive
table.setColumnFilter('city', { type: 'in', value: ['Bangkok', 'Chiang Mai'] })
table.setColumnFilter('age', { type: 'range', value: { min: 18, max: 65 } }) // inclusive
table.setColumnFilter('joined', { type: 'range', value: { min: new Date('2024-01-01') } })
table.setColumnFilter('tags', { type: 'equals', value: 'admin' }) // any element matches

console.log(table.getRowModel().filteredCount)
console.log(table.getState().columnFilters.age) // { type: 'range', value: { min: 18, max: 65 } }

table.setColumnFilter('city', undefined) // removes one filter
table.resetColumnFilters() // removes them all
```

- Filters on different columns combine with **AND**.
- A `null` or `undefined` cell (or `NaN` in a number column) matches no active filter.
- An array cell (`tags: string[]`) matches when **any** element matches; the filter kinds are those
  of the element type.
- `setColumnFilter(id, undefined)` removes that column's filter; `resetColumnFilters()` removes
  every filter.
- The step runs in the `filter` stage, with `validity()`, before search, sort and pagination. With
  `pagination()`, a filter change goes back to page 0 (`autoResetPageIndex`).

## Options

`columnFilters(options?)`, from `@datakable/core/column-filters` (also `@datakable/core` and
`datakable`):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `mode` | `'client' \| 'server'` | `'client'` | `'server'`: the server filters. Core skips this step; the slice goes to the `fetcher` as `filters`, or your app fetches with it. |

## State and API

The slice is `columnFilters`, typed `ColumnFiltersState<T>`: an object with at most one filter per
column path, `{}` by default.

| Method | Description |
| --- | --- |
| `setColumnFilter(id, filter)` | Sets the filter of column `id` (a key path of the row type); `undefined` removes it. |
| `resetColumnFilters()` | Removes every column filter. |

## Filter kinds

| Kind | Value | Matches | Inactive when `value` is |
| --- | --- | --- | --- |
| `equals` | `E \| null \| undefined` | strict equality; `Date`s by time value | `undefined`, `null` or `''` |
| `contains` | `string \| undefined` | case-insensitive, NFC-normalised substring (Thai combining marks compare correctly) | `undefined` or `''` |
| `in` | `readonly E[] \| undefined` | the cell is one of the values (`Date`s by time value) | `undefined`, or an array with no non-null value |
| `range` | `{ min?: E; max?: E } \| undefined` | `min <= cell <= max`, inclusive; a missing bound is open | `undefined`, or no bound given (`undefined`, `null` and `''` bounds count as not given) |
| `custom` | `{ value?: unknown; fn: (value, filterValue, row) => boolean }` | `fn` returns a truthy value | never: a custom filter is always active |

`E` is the column's value type (its element type for an array column). An inactive filter stays in
the state, so you can bind an input to it directly and an empty input shows every row:

```ts
import { createTable } from '@datakable/core'
import { columnFilters } from '@datakable/core/column-filters'

type User = { id: number; name: string; age: number }
declare const users: User[]
declare const input: { name: string; minAge: string }

const table = createTable({ data: users, rowKey: 'id', features: [columnFilters()] })

// Bind inputs directly: an empty value leaves the filter in the state but inactive.
table.setColumnFilter('name', { type: 'contains', value: input.name }) // '' → inactive
table.setColumnFilter('age', {
  type: 'range',
  // Convert before filtering: a string bound would match nothing (DK_FILTER_TYPE_MISMATCH).
  value: { min: input.minAge === '' ? undefined : Number(input.minAge) }, // no bound → inactive
})
```

A custom filter gets the whole cell value (non-nullish: `null` / `undefined` cells are skipped
before `fn` runs; arrays are passed as is), the filter's `value` (typed `unknown`) and the row:

```ts
import { createTable } from '@datakable/core'
import { columnFilters } from '@datakable/core/column-filters'

type Product = { sku: string; name: string; price: number; stock: number }
declare const products: Product[]

const table = createTable({ data: products, rowKey: 'sku', features: [columnFilters()] })

// `fn` gets the cell value (typed by the column), the filter's `value` and the row.
table.setColumnFilter('price', {
  type: 'custom',
  value: 0.2,
  fn: (price, maxDiscount, row) => row.stock > 0 && price * (1 - Number(maxDiscount)) < 100,
})
```

## Which kinds a column allows

The allowed kinds come from the column's value type (`FilterFor<V>`), so a wrong kind is a compile
error. `custom` is allowed on every column.

| Value type | Kinds |
| --- | --- |
| `number`, `bigint`, `Date` | `range`, `equals`, `in` |
| `string` | `equals`, `in`, `contains` |
| `boolean` | `equals` |
| an array of the above | the element type's kinds |
| `unknown`, `any` (and every column of an `any` row) | `equals`, `contains` |

```ts
import { createTable } from '@datakable/core'
import { columnFilters } from '@datakable/core/column-filters'

type User = { id: number; name: string; active: boolean; manager: { name: string } | null }
declare const users: User[]

const table = createTable({ data: users, rowKey: 'id', features: [columnFilters()] })

table.setColumnFilter('manager.name', { type: 'contains', value: 'ann' }) // dot-paths work
// @ts-expect-error 'range' needs a number, bigint or Date column; name is a string
table.setColumnFilter('name', { type: 'range', value: { min: 'a' } })
// @ts-expect-error a boolean column takes 'equals' only
table.setColumnFilter('active', { type: 'in', value: [true] })
// @ts-expect-error 'nmae' is not a path of User
table.setColumnFilter('nmae', { type: 'equals', value: 'x' })
```

A column definition's `filter: { type }` field declares the kind the column takes and is checked the
same way; it does not set a filter ([Columns and row keys](columns-and-row-keys.md)).

## Values of the wrong type

Runtime data does not always match its type. The table never throws on it:

- **A cell of the wrong type** (a string in a `range` column, say) is a non-match; the table reports
  `DK_FILTER_TYPE_MISMATCH` once per filter run with the count and sample rows, and the other rows
  are filtered normally.
- **A malformed filter value** (a string bound in a `range`, an object in `equals`, an unknown
  kind) matches no row, and the table reports `DK_FILTER_TYPE_MISMATCH` naming the expected value.
  Convert input values before setting them (`Number(input)`).
- **A `custom` filter that throws** treats that row as non-matching and reports
  `DK_CALLBACK_FAILED`.
- **A filter on an id that is not a column** (for example from an old URL) is ignored, and the
  table reports `DK_STATE_UNKNOWN_KEY`. A zero-config table (no `columns`) has a column per
  top-level key only: to filter on a nested path such as `'address.city'`, list it in `columns`.

None of these sets `status: 'error'`: they are handled inside the step, and the row model stays
current.

## Server mode

With `columnFilters({ mode: 'server' })`, core holds the slice but does not filter: the
`fetcher` receives it as `filters` (the slice as is, inactive entries included) and runs again
whenever it changes. Without a fetcher, read `getState().columnFilters` and pass the filtered page
as `data` yourself. See [Server mode](server-mode.md).

```ts
import { createTable, type FetchResult } from '@datakable/core'
import { columnFilters } from '@datakable/core/column-filters'
import { withFetcher } from '@datakable/core/server'

type User = { id: number; name: string; city: string }

const table = createTable({
  rowKey: 'id',
  // Server mode: core skips the filter step; the slice goes to the fetcher as `filters`.
  features: [columnFilters({ mode: 'server' })],
  fetcher: withFetcher(async ({ filters, signal }) => {
    const res = await fetch(`/api/users?filters=${JSON.stringify(filters ?? {})}`, { signal })
    return (await res.json()) as FetchResult<User>
  }),
})

table.setColumnFilter('city', { type: 'equals', value: 'Bangkok' }) // fetches again
```

## Pitfalls

- **Nothing matches after binding a numeric input**: the bound is a string. Convert it; the table
  reports [`DK_FILTER_TYPE_MISMATCH`](../how-to-fix/errors.md#dk_filter_type_mismatch).
- **Some rows disappear unexpectedly**: their cells are `null` or of another runtime type. Check
  `table.explainRow(key)` ([Diagnostics](diagnostics.md)) and
  [`DK_FILTER_TYPE_MISMATCH`](../how-to-fix/errors.md#dk_filter_type_mismatch).
- **A filter from saved state, or on a nested path of a zero-config table, does nothing**: the id
  is not a column (renamed, or never listed in `columns`) —
  [`DK_STATE_UNKNOWN_KEY`](../how-to-fix/errors.md#dk_state_unknown_key).
- **Changing an array after passing it as a filter value**: in development the table freezes the
  state it stores, including the arrays inside it, so `ids.push(3)` after
  `setColumnFilter('id', { type: 'in', value: ids })` throws a `TypeError`. Pass a new array
  (`setColumnFilter('id', { type: 'in', value: [...ids, 3] })`); production does not freeze.
- **A `custom` fn throws**: [`DK_CALLBACK_FAILED`](../how-to-fix/errors.md#dk_callback_failed).
- **`range` on a string column does not compile**:
  [filter kind not allowed](../how-to-fix/reading-type-errors.md#3-filter-kind-not-allowed-for-the-value-type).

## See also

- [Features](features.md) — the preset and pipeline order.
- [Validity](validity.md) — the other `filter`-stage feature.
- [Search](search.md) — fuzzy search across columns.
- [State](state.md) — controlled filters, e.g. synced with the URL.
- [`@datakable/core` features](../../packages/core/README.md#features)
- [A headless table](../examples/headless-table.md) — a column filter in a recipe.
- [Sorting or filtering does nothing](../how-to-fix/sorting-or-filtering-does-nothing.md) and [the
  table shows no rows](../how-to-fix/no-rows.md) — troubleshooting.
- [Examples](../examples/README.md)
