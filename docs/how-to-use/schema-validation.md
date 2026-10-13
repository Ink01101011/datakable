# Schema validation

This page is for data you do not fully trust — JSON from an API, a file import — that you want
checked row by row before the table shows it. You pass a [Standard Schema](https://standardschema.dev)
(zod, valibot, arktype, …); the table validates every row, types its rows as the schema's output,
and lets you choose what happens to the rows that fail.

## Validating rows with `withSchema`

Wrap the schema with `withSchema()` from `@datakable/core/schema` (also exported by
`@datakable/core` and `datakable`) and pass it as `schema`. Validation is an opt-in import, so a
table without a schema does not bundle it. A raw schema does not compile, and is
`DK_INVALID_OPTION` in every build.

```ts
import { createTable } from '@datakable/core'
import { type StandardSchemaV1, withSchema } from '@datakable/core/schema'
import { sorting } from '@datakable/core/sorting'

type User = { id: number; name: string; joined: Date }
// Any Standard Schema v1: zod, valibot, arktype, … e.g.
// z.object({ id: z.number(), name: z.string(), joined: z.coerce.date() })
declare const UserSchema: StandardSchemaV1<unknown, User>
declare const json: unknown[] // e.g. await res.json(): not trusted yet

const table = createTable({
  data: json, // raw input: every row is validated
  schema: withSchema(UserSchema), // the row type is the schema's output: User
  rowKey: 'id',
  features: [sorting()],
})

table.toggleSort('joined') // typed against User
for (const row of table.getRowModel().rows) {
  console.log(row.original.joined.getFullYear()) // the output value (a Date, after coercion)
}
// invalidRows: 'drop' (the default) removed the failing rows; they are still listed here:
for (const { index, raw, issues } of table.getInvalidRows()) console.warn(index, raw, issues)
```

- **The row type is the schema's output.** `data` (and `initialData`, and a fetcher's `rows`) are
  the raw input, typed `unknown[]`; columns, filters, sorting and `row.original` are typed against
  the output.
- **Every row is validated** when the data is ingested: at creation, on `setOptions({ data })`
  and for each fetcher result. The result is memoised per data array, so the same array is
  validated once.
- **The output replaces the input.** Rows hold what the schema returned, so transforms and
  coercions (a date string to a `Date`) apply.
- **Async schemas** work: while one runs, `getRowModel().status` is `'validating'` and the table
  keeps its previous data.
- `withSchema` is memoised per schema object, so calling it inline in a React render keeps one
  identity. `schema` and `invalidRows` are read once, at creation.

## Choosing what happens to invalid rows

`invalidRows` decides the fate of the rows that fail. Every mode reports
`DK_SCHEMA_INVALID_ROW` (its `fix` names the failing paths and the columns that show them) and lists
the rows in `table.getInvalidRows()`.

| `invalidRows` | Invalid rows | `getRowModel().rows` type |
| --- | --- | --- |
| `'drop'` (default) | removed from the table | `Row<T>[]` |
| `'flag'` | kept, with `row.valid === false` and their issues | `FlaggedRow<T>[]`: narrow on `row.valid` |
| `'throw'` | `createTable` / `setOptions({ data })` throws `DatakableSchemaError`; the previous data is kept | `Row<T>[]` |

`getInvalidRows()` returns `readonly InvalidRow[]`, empty without a schema:

| Field | Type | |
| --- | --- | --- |
| `index` | `number` | position in the data you passed, before invalid rows were dropped |
| `raw` | `unknown` | the row as given, before validation |
| `issues` | `readonly RowIssue[]` | the validator's issues: `{ message, path? }` |

### Flagging rows

With `'flag'`, a row is a union: `row.valid === true` narrows `row.original` to the schema output;
`row.valid === false` leaves it `unknown` (the raw value). Each row also has:

| Member | Type | |
| --- | --- | --- |
| `valid` | `boolean` | `false` for a flagged row |
| `issues` | `readonly RowIssue[]` | the row's issues (empty for a valid row) |
| `getCellIssues(id)` | `readonly RowIssue[]` | the issues that touch column `id` |

`getCellIssues` matches an issue path against the column key segment by segment: the path equals
the key, or one contains the other (`address.city` touches the `address` column and the other way
round; `address` never touches `addressLine`). An issue without a path is a row-level issue and
touches every column; accessor columns have no key, so they get only row-level issues.

```ts
import { createTable } from '@datakable/core'
import { type StandardSchemaV1, withSchema } from '@datakable/core/schema'
import { validity } from '@datakable/core/validity'

type User = { id: number; name: string; email: string }
declare const UserSchema: StandardSchemaV1<unknown, User>
declare const json: unknown[]

const table = createTable({
  data: json,
  schema: withSchema(UserSchema),
  invalidRows: 'flag', // keep the failing rows, marked invalid
  columns: [{ key: 'name' }, { key: 'email' }],
  features: [validity()],
})

for (const row of table.getRowModel().rows) {
  if (row.valid) {
    console.log(row.original.email) // narrowed: original is a User
  } else {
    // original is the raw, unvalidated value (unknown)
    console.warn(row.issues) // every issue of the row
    console.warn(row.getCellIssues('email')) // the issues whose path touches `email`
  }
}

table.setValidity('invalid') // only the flagged rows, e.g. for a "needs fixing" view
```

The [`validity()`](validity.md) feature filters a flagged table to `'all'`, `'valid'` or
`'invalid'` rows; it works only with `invalidRows: 'flag'`.

### Throwing

`'throw'` is for flows where invalid data must stop the import. The error is a
`DatakableSchemaError` (a `DatakableError` with the diagnostic's `code`, `where` and `fix`), with
the failing rows in `invalidRows`.

```ts
import { createTable } from '@datakable/core'
import { DatakableSchemaError, type StandardSchemaV1, withSchema } from '@datakable/core/schema'

type User = { id: number; name: string }
declare const UserSchema: StandardSchemaV1<unknown, User>
declare const json: unknown[]

// 'throw': invalid data is an error the caller must handle (e.g. a strict import screen).
try {
  const table = createTable({ data: json, schema: withSchema(UserSchema), invalidRows: 'throw' })
  console.log(table.getRowModel().totalCount)
} catch (e) {
  if (!(e instanceof DatakableSchemaError)) throw e
  // The same list getInvalidRows() would return: { index, raw, issues }.
  console.error(e.code, e.invalidRows.length)
}
```

## Rendering invalid cells

A column's `invalidCell` renders the cells of a flagged row that have issues. It receives an
`InvalidCellContext`:

| Field | Type | |
| --- | --- | --- |
| `original` | `unknown` | the raw, unvalidated row |
| `value` | `unknown` | the cell's raw value (the column's key path or accessor over `original`) |
| `issues` | `readonly RowIssue[]` | the row's issues that touch this cell (`row.getCellIssues(column)`) |

Its return type is the column's render type (`ReactNode` in React). Without `invalidCell`,
`<DataTable />` shows the raw value through the default formatter with a `⚠` marker, and marks the
row and the cell with `data-invalid` / `aria-invalid` and a `title` listing the issue paths (never
the messages, which often embed the received value).

```tsx
import { type ColumnDef, type StandardSchemaV1, useDataTable, withSchema } from 'datakable'
import type { ReactNode } from 'react'

type User = { id: number; name: string; email: string }
declare const UserSchema: StandardSchemaV1<unknown, User>

const columns: ColumnDef<User, ReactNode>[] = [
  { key: 'name', header: 'Name' },
  {
    key: 'email',
    header: 'Email',
    cell: ({ value }) => <a href={`mailto:${value}`}>{value}</a>, // valid rows: value is a string
    // Flagged rows whose issues touch this cell: the raw value, typed unknown.
    invalidCell: ({ value, issues }) => (
      <span title={issues.map((i) => i.message).join('; ')}>{String(value ?? '')} ⚠</span>
    ),
  },
]

export function Users({ json }: { json: unknown[] }) {
  const table = useDataTable({
    data: json,
    schema: withSchema(UserSchema),
    invalidRows: 'flag',
    rowKey: 'id',
    columns,
  })
  return <p>{table.getInvalidRows().length} rows need fixing</p>
}
```

## When the schema itself fails

A schema that throws (or rejects) instead of returning issues reports `DK_SCHEMA_CRASHED`. The row
gets a synthetic issue and is handled by `invalidRows` like any invalid row, so the table keeps
working.

## Pitfalls

- **A schema passed without `withSchema()`** does not compile and throws
  [`DK_INVALID_OPTION`](../how-to-fix/errors.md#dk_invalid_option).
- **Rows disappear** with the default `'drop'`: they are reported as
  [`DK_SCHEMA_INVALID_ROW`](../how-to-fix/errors.md#dk_schema_invalid_row) and listed in `getInvalidRows()`.
  Use `'flag'` to show them.
- **A throwing validator** is [`DK_SCHEMA_CRASHED`](../how-to-fix/errors.md#dk_schema_crashed): every row it
  crashed on counts as invalid.
- **`invalidRows: 'flag'` (or `'throw'`) without `schema`** does nothing:
  [`DK_OPTION_NO_EFFECT`](../how-to-fix/errors.md#dk_option_no_effect). So does `setValidity('invalid')` when
  the table is not in `'flag'` mode.
- **Changing `schema` or `invalidRows` later** has no effect: both are read once, at creation
  ([`DK_OPTION_NO_EFFECT`](../how-to-fix/errors.md#dk_option_no_effect) in development). Create a new table.
- **A `cell` reading `row` fields of a flagged row:** with `'flag'`, `cell` only runs for cells
  without issues, but `row` there is the raw value of a flagged row; narrow before you trust it, or
  render issues with `invalidCell`.

## See also

- [Validity](validity.md) — filter flagged rows.
- [Columns and row keys](columns-and-row-keys.md) — `cell`, `format` and `invalidCell`.
- [Server mode](server-mode.md) — fetched rows are validated too.
- [Diagnostics](diagnostics.md) — schema messages are redacted under `'safe'` and `'keys'`.
- [`@datakable/core` schema validation](../../packages/core/README.md#schema-validation)
- [Validate rows with a schema](../examples/schema-validation.md) — the recipe.
- [`DK_INVALID_OPTION` for `schema`](../how-to-fix/unwrapped-schema-fetcher-or-searchfn.md) — a
  schema passed without `withSchema`.
- [Examples](../examples/README.md)
