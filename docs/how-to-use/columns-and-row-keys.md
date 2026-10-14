# Columns and row keys

How a table knows what to show and how to tell rows apart. This page covers the columns DataKable
derives from your data, every field of a column definition and what it does at runtime, dot-path
keys, derived columns, the rendering rules the type checker enforces, and `rowKey`.

## Zero-config columns

`columns` is optional. Without it, the table derives one column per top-level key of your rows:
the union of the keys over the first 50 rows, in first-seen order. Keys whose value is a function
are skipped, and so are keys that contain a `.` (a column key is a dot-path, so it could not address
them). When the sampled rows have different key sets, the table reports
`DK_INCONSISTENT_ROW_SHAPE` (info) and uses the union; missing cells render `''`.

```ts
import { createTable } from 'datakable'

type User = { id: number; name: string; age: number; joined: Date }
declare const users: User[]

// No `columns`: one column per top-level key of the first 50 rows (id, name, age, joined).
const table = createTable({ data: users, rowKey: 'id' })

const row = table.getRowModel().rows[0]
console.log(row?.getValue('joined')) // the Date; rendered with toLocaleString()
```

Derived columns use the key as the header and the default formatter for the cells. Pass `columns`
as soon as you need headers, nested values, formatting or search weights.

## Column definitions

`columns` is an array of `ColumnDef<T, R>`. A column is either a **key column** (`key`, a dot-path
of the row type) or a **derived column** (`id` + `accessor`). Each key column is typed against the
value at its path, so `filter`, `cell`, `format` and `sortFn` see the right value type without a
helper.

```ts
import { createTable } from '@datakable/core'
import { columnFilters } from '@datakable/core/column-filters'
import { search } from '@datakable/core/search'
import { sorting } from '@datakable/core/sorting'

type User = {
  id: number
  name: string
  email: string
  age: number
  joined: Date
  tags: string[]
  address: { city: string; zip: string }
  manager: { name: string } | null
}
declare const users: User[]

const table = createTable({
  data: users,
  rowKey: 'id',
  features: [columnFilters(), search(), sorting()],
  columns: [
    { key: 'name', header: 'Name', search: 2 }, // search weight 2
    { key: 'age', header: 'Age', filter: { type: 'range' } },
    { key: 'joined', header: 'Joined', format: (d) => d.toISOString().slice(0, 10) },
    { key: 'tags', search: 1 }, // arrays of primitives render joined: "a, b"
    { key: 'address.city', header: 'City', search: 1 }, // a dot-path, typed against User
    { key: 'manager.name', header: 'Manager' }, // a nullable parent is fine
    { key: 'address', format: (a) => `${a.city} ${a.zip}` }, // an object needs format or cell
    { key: 'email', sensitive: true }, // never written to diagnostics
  ],
})

table.toggleSort('address.city')
```

| Field | Type | Description |
| --- | --- | --- |
| `key` | `Path<T>` | A dot-path of the row (`'address.city'`). Key columns only. The column id is the key. |
| `id` | `string` | The column id of a derived column. Required with `accessor`. |
| `accessor` | `(row: T) => unknown` | Computes a derived column's value from the row. |
| `header` | `string` | Header text. `<DataTable />` shows the column id when it is missing. |
| `search` | `number` | Search weight. When any column declares `search`, only the columns with a weight above 0 are searched; when none does, the columns of strings, numbers and booleans are searched at weight 1 (a date, array or object column needs a weight). See [Search](search.md). |
| `sortable` | `boolean` | `false` hides the sort button in `<DataTable />`. Core's `toggleSort` / `setSorting` do not read it. On an object column, `sortable: true` needs `sortFn` or `sortBy` (a compile-time rule). |
| `sortFn` | `(a: V, b: V) => number` | Compares two cell values (`V` is the column's value type). |
| `sortBy` | `(row: T) => Primitive` | Sorts by a primitive computed from the row. |
| `sortAlgorithm` | `'auto' \| 'tim' \| 'radix' \| 'counting' \| 'native' \| (indices, compare) => indices` | The sort algorithm for this column; takes precedence over `sorting({ algorithm })`. See [Sorting](sorting.md). |
| `filter` | `FilterFor<V>` (`{ type: 'equals' \| 'contains' \| 'in' \| 'range' }`, as allowed for `V`) | Declares which filter kind the column takes; type-checked against the value type. It does not set a filter at runtime — use `setColumnFilter`. See [Column filters](column-filters.md). |
| `sensitive` | `boolean` | The column's values are never written to diagnostics, at any redaction level. |
| `cell` | `(ctx: { row: T; value: V }) => R` | Renders the cell. `R` is `unknown` in core and `ReactNode` in React. |
| `format` | `(value: V) => string` | Formats the value as a string. Also what search matches on and what `<DataTable />` shows when there is no `cell`. |
| `invalidCell` | `(ctx: { original: unknown; value: unknown; issues: readonly RowIssue[] }) => R` | Renders a cell of a row flagged by schema validation (`invalidRows: 'flag'`). See [Schema validation](schema-validation.md). |

### Dot-path keys

`key` is a dot-path of the row type, checked by the compiler: a typo, in a top-level or a nested
key, is a compile error. Paths go up to 4 levels below the root (`a.b.c.d.e`). Arrays, functions and
`Date` values are leaves: they are columns themselves, but the path does not go inside them. A
nullable parent is fine (`manager.name` when `manager` may be `null`): the value type becomes
`string | null`, and at runtime a `null` or non-object part-way through reads `undefined` — a path
never throws.

### What a cell shows

Without `cell` or `format`, values go through the default formatter:

| Value | Shown as |
| --- | --- |
| `null`, `undefined` | `''` |
| string, number, bigint, boolean | `String(value)` |
| a valid `Date` | `value.toLocaleString()` (an invalid `Date`: `''`) |
| an array of the above | the elements joined with `', '` |
| an object, a function, an array holding one | `''`, and `DK_UNRENDERABLE_VALUE` |

So the type checker requires `cell` or `format` on a column whose value is an object, a function
or an array of objects. Primitives, `Date`, arrays of primitives, `unknown` and `any` need neither.
[Reading type errors](../how-to-fix/reading-type-errors.md) explains the error messages these rules produce:

```ts
import { createTable } from '@datakable/core'
import { search } from '@datakable/core/search'
import { sorting } from '@datakable/core/sorting'

type User = { id: number; first: string; last: string; born: number }
declare const users: User[]

const table = createTable({
  data: users,
  rowKey: 'id',
  features: [search(), sorting()],
  columns: [
    // A derived column: `u` is typed as User. Shown and searched like any other column.
    { id: 'fullName', accessor: (u) => `${u.first} ${u.last}`, header: 'Name', search: 1 },
    // To sort by a computed value through the typed API, give a key column a `sortBy`.
    { key: 'last', header: 'Family name', sortBy: (u) => `${u.last} ${u.first}` },
    { key: 'born', header: 'Age', format: (year) => String(2026 - year) },
  ],
})

table.toggleSort('last') // sorts by "last first"
console.log(table.getRowModel().rows[0]?.getValue('fullName'))
```

### Derived columns

A derived column computes its value with `accessor`, which gets the row typed as your row type. It
is rendered, searched (with a `search` weight) and can be formatted like a key column. Its value
type is `unknown`: `format` and `sortFn` receive `unknown`, and `filter` allows only `equals` and
`contains`.

```tsx
import { type ColumnDef, DataTable } from 'datakable'
import type { ReactNode } from 'react'

type User = { id: number; name: string; email: string; address: { city: string } }

// Hoisted: React compares `columns` by reference. `ReactNode` is the type `cell` returns.
const columns: ColumnDef<User, ReactNode>[] = [
  {
    key: 'name',
    header: 'Name',
    cell: ({ row, value }) => <a href={`/users/${row.id}`}>{value}</a>,
  },
  { key: 'email', header: 'Email', cell: ({ value }) => <a href={`mailto:${value}`}>{value}</a> },
  { key: 'address', header: 'City', cell: ({ value }) => <em>{value.city}</em> },
]

export function Users({ users }: { users: User[] }) {
  return <DataTable data={users} rowKey="id" columns={columns} />
}
```

The typed feature methods — `toggleSort`, `setSorting`, `setColumnFilter` — take key paths of the
row type, not derived column ids. To sort or filter on a computed value through them, give a key
column a `sortBy`, or use a `custom` filter on a key column. `<DataTable />`'s header buttons sort
derived columns too.

### Rendering with React

With React, `cell` returns a `ReactNode`: type the columns as `ColumnDef<User, ReactNode>[]`. Define
them outside the component (or memoise them): `useDataTable` compares `columns` by reference, and a
new array on every render re-runs the pipeline (`DK_UNSTABLE_COLUMNS` warns in development).

```ts
import { type ColumnDef, createTable } from '@datakable/core'

type User = { id: number; name: string; address: { city: string }; onClick: () => void }
declare const users: User[]

export const columns: ColumnDef<User>[] = [
  // @ts-expect-error 'nmae' is not a path of User
  { key: 'nmae' },
  // @ts-expect-error an object column needs `cell` or `format`
  { key: 'address' },
  // @ts-expect-error 'range' is a number / bigint / Date filter, and name is a string
  { key: 'name', filter: { type: 'range' } },
  // @ts-expect-error sortable: true on an object column needs `sortFn` or `sortBy`
  { key: 'address', format: (a) => a.city, sortable: true },
  { key: 'address', format: (a) => a.city, sortable: true, sortBy: (u) => u.address.city },
]

// @ts-expect-error rowKey must be a path of User (or a function)
createTable({ data: users, rowKey: 'uuid' })
```

A `cell` that throws renders `⚠` in that cell and reports `DK_CALLBACK_FAILED`; the other cells keep
rendering. See [React](react.md).

## Row keys

`rowKey` tells the table how to identify a row: a path of the row type whose value is a string or a
number, or a function `(row) => string | number`. The key is `row.key`, and `explainRow(key)`,
`searchFn` results (`{ keys }`) and React's list keys use it.

```ts
import { createTable } from '@datakable/core'

type Order = { orderId: string; customer: { id: number }; line: number }
declare const orders: Order[]

// A path of the row type: the value must be a string or a number, unique across all rows.
const byId = createTable({ data: orders, rowKey: 'orderId' })

// A function, for a key made of several fields.
const byLine = createTable({
  data: orders,
  rowKey: (o) => `${o.orderId}-${o.line}`,
})

// Keys are computed over all rows, so they stay the same when you filter, sort or page.
for (const row of byLine.getRowModel().rows) console.log(row.key, row.index)
console.log(byId.getRowModel().rows[0]?.key)
```

- Keys are computed once per data and `rowKey`, over **all** rows, so a row keeps its key when you
  filter, sort or change the page.
- Without `rowKey`, the key is the row's index in the data. That is fine for static data, but
  indices change when rows are added or removed.
- **Duplicates:** the first row keeps the key; later rows get `key#1`, `key#2`, … and the table
  reports `DK_DUPLICATE_ROW_KEY`, whose fix names fields that are unique across all rows.
- **Missing keys:** a row whose key is missing, `null`, `NaN` or not a string or number gets the
  fallback `#<index>` and the table reports `DK_MISSING_ROW_KEY`.
- A `rowKey` function that throws gives that row the `#<index>` fallback and reports
  `DK_CALLBACK_FAILED`.
- A `rowKey` path that points into a `sensitive` column is hashed in diagnostics at every
  redaction level.

## Loose row types

When the row type is `any` (for example `any[]` from untyped JSON), DataKable treats it as
`Record<string, unknown>`: any key compiles, and filters are limited to the type-agnostic kinds,
`equals` and `contains`. A field typed `any` or `unknown` inside a typed row needs no `cell` and also
takes only those two kinds. For full checking, type the data (`createTable<User>(…)`) or validate it
with a schema ([Schema validation](schema-validation.md)), whose output becomes the row type.

## Pitfalls

- **A key that no row has** is [`DK_COLUMN_PATH_NOT_FOUND`](../how-to-fix/errors.md#dk_column_path_not_found)
  (with a did-you-mean); a key missing in some rows is
  [`DK_COLUMN_PATH_PARTIAL`](../how-to-fix/errors.md#dk_column_path_partial). Both are development checks over
  the first 50 rows.
- **An object value without `cell` or `format`** is a compile error
  ([object column](../how-to-fix/reading-type-errors.md#4-object-column-without-cell-or-format)); untyped data
  that reaches the default formatter renders `''` and reports
  [`DK_UNRENDERABLE_VALUE`](../how-to-fix/errors.md#dk_unrenderable_value).
- **Duplicate or missing keys** fall back to `key#n` / `#index`:
  [`DK_DUPLICATE_ROW_KEY`](../how-to-fix/errors.md#dk_duplicate_row_key),
  [`DK_MISSING_ROW_KEY`](../how-to-fix/errors.md#dk_missing_row_key).
- **A `format` that returns a non-string** or a `cell` that returns a Promise:
  [`DK_CALLBACK_BAD_RETURN`](../how-to-fix/errors.md#dk_callback_bad_return) (development). A callback that
  throws: [`DK_CALLBACK_FAILED`](../how-to-fix/errors.md#dk_callback_failed).
- **A new `columns` array on every render** in React:
  [`DK_UNSTABLE_COLUMNS`](../how-to-fix/errors.md#dk_unstable_columns).
- **Sorting a derived column with the typed API** does not compile: use a key column with
  `sortBy` (above).

## See also

- [Column filters](column-filters.md), [Search](search.md), [Sorting](sorting.md) — how the
  features read columns.
- [Schema validation](schema-validation.md) — `invalidCell` and cell issues.
- [Diagnostics](diagnostics.md) — redaction and `sensitive` columns.
- [Reading type errors](../how-to-fix/reading-type-errors.md)
- [`@datakable/core` columns](../../packages/core/README.md#columns)
- [Custom columns](../examples/custom-columns.md) — the recipe.
- [Examples](../examples/README.md)
