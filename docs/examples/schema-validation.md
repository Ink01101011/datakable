# Validate rows with a schema and flag the invalid ones

Data from an API or a file is not always the shape you expect. With a schema, every row is
validated before the table uses it; with `invalidRows: 'flag'`, the invalid rows stay in the table,
marked, so users can see and fix them instead of losing them silently.

## Goal

Validate raw account rows, keep the invalid ones flagged in the table with the schema's message on
the bad cell, and add a checkbox that shows only the invalid rows.

## The code

The schema: any [Standard Schema](https://standardschema.dev) works (zod, valibot, arktype, …).

```ts
import type { StandardSchemaV1 } from 'datakable'

export type Account = { id: number; email: string; balance: number }

// Any Standard Schema v1 works: with zod, `z.object({ id: z.number(), email: z.email(),
// balance: z.number() })`; valibot and arktype the same. Written by hand here, so the recipe
// needs no schema library.
export const AccountSchema: StandardSchemaV1<unknown, Account> = {
  '~standard': {
    version: 1,
    vendor: 'example',
    validate(input) {
      const v = (typeof input === 'object' && input !== null ? input : {}) as Record<
        string,
        unknown
      >
      const issues: StandardSchemaV1.Issue[] = []
      if (typeof v.id !== 'number') issues.push({ message: 'Expected a number', path: ['id'] })
      if (typeof v.email !== 'string' || !v.email.includes('@')) {
        issues.push({ message: 'Expected an email', path: ['email'] })
      }
      if (typeof v.balance !== 'number') {
        issues.push({ message: 'Expected a number', path: ['balance'] })
      }
      if (issues.length > 0) return { issues }
      return {
        value: { id: v.id as number, email: v.email as string, balance: v.balance as number },
      }
    },
  },
}
```

The table:

```tsx
import {
  type ColumnDef,
  DataTable,
  type InvalidCellContext,
  useDataTable,
  withSchema,
} from 'datakable'
import type { ReactNode } from 'react'
import { type Account, AccountSchema } from './1-account-schema'

// A flagged cell shows its raw value and the schema's message.
const flagged = ({ value, issues }: InvalidCellContext) => (
  <span title={issues.map((i) => i.message).join('; ')}>{String(value)} ⚠</span>
)

const columns: ColumnDef<Account, ReactNode>[] = [
  { key: 'id', header: 'ID' },
  { key: 'email', header: 'Email', invalidCell: flagged },
  { key: 'balance', header: 'Balance', invalidCell: flagged },
]

// `json` is raw input, e.g. `await res.json()`: every row is validated.
export function AccountsTable({ json }: { json: unknown[] }) {
  const table = useDataTable({
    data: json,
    schema: withSchema(AccountSchema), // the row type is the schema's output: Account
    invalidRows: 'flag', // keep invalid rows, marked; 'drop' (default) removes them
    rowKey: 'id',
    columns,
  })
  const invalid = table.getInvalidRows().length

  return (
    <section>
      <label>
        <input
          type="checkbox"
          checked={table.state.validity === 'invalid'}
          onChange={(e) => table.setValidity(e.target.checked ? 'invalid' : 'all')}
        />
        Show only the {invalid} invalid rows
      </label>
      {/* Flagged rows get data-invalid / aria-invalid; style them, or use styles.css. */}
      <DataTable table={table} caption="Accounts" />
    </section>
  )
}
```

## What you will see

- Every row, valid or not: rows that fail the schema have `data-invalid="true"` and
  `aria-invalid="true"` on the `<tr>`, and the bad cells get the same attributes on the `<td>`.
  `datakable/styles.css` tints them ([Theming](theming.md)).
- A bad cell renders through `invalidCell`: the raw value with ⚠, and the schema's message as its
  tooltip (`not-an-email ⚠`, "Expected an email").
- The checkbox label counts the invalid rows (`getInvalidRows()`); checking it calls
  `setValidity('invalid')` and only the flagged rows remain, unchecking shows all of them again.
- `DK_SCHEMA_INVALID_ROW` is reported (console in development, and `onDiagnostic`), naming the
  rows and the columns their issues map to.
- In your code, `row.valid` narrows the row: `row.original` is an `Account` when it is `true`, and
  `unknown` (the raw input) when it is `false`.

## Variations

- **Drop them:** leave `invalidRows` out (`'drop'` is the default): invalid rows are removed and
  listed in `getInvalidRows()`, still with `DK_SCHEMA_INVALID_ROW`.
- **Refuse the data:** `invalidRows: 'throw'` throws `DatakableSchemaError` and keeps the previous
  data.
- **A select instead of a checkbox:** `setValidity` takes `'all' | 'valid' | 'invalid'`.
- **Async schemas:** a schema whose `validate` returns a promise sets `status: 'validating'` while
  it runs.
- **Fetched data:** with a `fetcher`, the returned rows go through the same schema
  ([Server-side table](server-side-table.md)).

## See also

- [Schema validation](../../packages/core/README.md#schema-validation) in `@datakable/core`.
- [How to fix](../how-to-fix/README.md) — `DK_SCHEMA_INVALID_ROW`, `DK_SCHEMA_CRASHED`.
- [Examples](README.md)
