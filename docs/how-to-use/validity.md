# Validity

`validity()` filters a schema-validated table by the result of validation: every row, only the rows
that passed, or only the rows that failed. Use it to build a "show invalid rows" toggle over data
you keep with `invalidRows: 'flag'`. This page covers when the filter is active, its state and API,
and what happens with other `invalidRows` modes.

## How it works

With a `schema` and `invalidRows: 'flag'`, rows that fail validation stay in the table with
`row.valid === false` ([Schema validation](schema-validation.md)). `validity()` adds a `validity`
slice — `'all'` (the default), `'valid'` or `'invalid'` — and a filter step that keeps the matching
rows. The step runs in the `filter` stage, with `columnFilters()`, before search, sort and
pagination, so `filteredCount` and the page count follow it.

```ts
import { createTable, type StandardSchemaV1 } from '@datakable/core'
import { withSchema } from '@datakable/core/schema'
import { validity } from '@datakable/core/validity'

type User = { id: number; name: string }
// Any Standard Schema v1: zod, valibot, arktype, …
declare const UserSchema: StandardSchemaV1<unknown, User>
declare const json: unknown[]

const table = createTable({
  data: json,
  schema: withSchema(UserSchema),
  invalidRows: 'flag', // keep invalid rows, flagged: validity() filters on that flag
  rowKey: 'id',
  features: [validity()],
})

table.setValidity('invalid') // only the rows that failed the schema
console.log(table.getRowModel().filteredCount, table.getInvalidRows().length)
table.setValidity('valid') // only the rows that passed
table.setValidity('all') // every row (the default)
```

`validity()` is in `datakable`'s default preset. In React, bind the slice to a control:

```tsx
import { type StandardSchemaV1, useDataTable, type ValidityState, withSchema } from 'datakable'

type User = { id: number; name: string; email: string }
declare const UserSchema: StandardSchemaV1<unknown, User>

const schema = withSchema(UserSchema)

export function Users({ json }: { json: unknown[] }) {
  // The default preset includes validity().
  const table = useDataTable({ data: json, schema, invalidRows: 'flag', rowKey: 'id' })
  return (
    <>
      <select
        value={table.state.validity}
        onChange={(e) => table.setValidity(e.target.value as ValidityState)}
      >
        <option value="all">All rows</option>
        <option value="valid">Valid only</option>
        <option value="invalid">Invalid only ({table.getInvalidRows().length})</option>
      </select>
      <ul>
        {table.rowModel.rows.map((row) =>
          row.valid ? (
            <li key={row.key}>{row.original.name}</li>
          ) : (
            <li key={row.key} aria-invalid="true">
              Row {row.index}: {row.issues.map((i) => i.message).join('; ')}
            </li>
          ),
        )}
      </ul>
    </>
  )
}
```

## Options

`validity()` takes no options. Import it from `@datakable/core/validity` (also `@datakable/core` and
`datakable`).

## State and API

The slice is `validity`, typed `ValidityState`: `'all' | 'valid' | 'invalid'`, default `'all'`.

| Method | Description |
| --- | --- |
| `setValidity(value)` | Shows every row (`'all'`), only the rows that passed the schema (`'valid'`), or only the flagged ones (`'invalid'`). |

Like any slice, it can also be set with `setState({ validity })`, `initialState.validity` or
controlled `state.validity` ([State](state.md)).

## When it has no effect

The filter is active only with `schema` **and** `invalidRows: 'flag'`. In every other mode there
are no flagged rows to filter: without a schema no row is invalid, with `'drop'` (the default)
invalid rows are removed at ingest, and with `'throw'` they throw. There, the step passes its rows
through, and a value other than `'all'` — from `setValidity`, `setState`, `initialState` or
controlled state — reports `DK_OPTION_NO_EFFECT`.

`getInvalidRows()` lists the rows that failed the schema in every mode, so you can show a count of
dropped rows without `validity()`.

## Pitfalls

- **`setValidity('invalid')` shows every row**: the table is not in flag mode (no `schema`, or
  `invalidRows` is not `'flag'`) —
  [`DK_OPTION_NO_EFFECT`](../how-to-fix/errors.md#dk_option_no_effect).
- **A value other than the three**, e.g. from a URL parameter: `setValidity` ignores the call, and
  a slice holding it reads as `'all'` —
  [`DK_INVALID_VALIDITY`](../how-to-fix/errors.md#dk_invalid_validity). Check the value before setting it.
- **Flagged rows render with their raw values**: narrow on `row.valid` before reading
  `row.original` as your row type, and give columns an `invalidCell` for broken cells
  ([Schema validation](schema-validation.md)).

## See also

- [Schema validation](schema-validation.md) — `withSchema`, `invalidRows`, `row.issues` and
  `getCellIssues`.
- [Column filters](column-filters.md) — the other `filter`-stage feature.
- [Features](features.md) — the preset and pipeline order.
- [`@datakable/core` schema validation](../../packages/core/README.md#schema-validation)
- [Validate rows with a schema](../examples/schema-validation.md) — a "show invalid" toggle in a
  recipe.
- [Examples](../examples/README.md)
