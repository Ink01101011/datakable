# The table shows no rows

`<DataTable />` shows its Empty state ("No rows" / "No matching rows"), or `rowModel.rows` is
empty, although you passed data. This page walks through the usual causes, from the most to the
least common, and how to tell which one you have.

## Confirm: where did the rows go?

`table.explain()` shows how many rows each step of the last pipeline run kept, from the data to
the page; `table.explainRow(key)` replays one row through every step and names the step that
removed it, with a fix. Both work in the browser console, in a test and on the server.

```ts
import { createTable } from 'datakable'

const products = [
  { sku: 'SKU-001', name: 'Desk chair', price: 120 },
  { sku: 'SKU-002', name: 'Desk lamp', price: 40 },
  { sku: 'SKU-003', name: 'Bookshelf', price: 150 },
]

// A filter restored from the URL that no product matches any more.
export const table = createTable({
  data: products,
  rowKey: 'sku',
  initialState: { columnFilters: { price: { type: 'range', value: { min: 500 } } } },
})

// Where did the rows go? Rows per step, from the data to the page.
console.log(String(table.explain()))
// Why is this row not shown? The step that removed it, and a fix.
console.log(String(table.explainRow('SKU-001')))
```

prints:

```text
run 1 0.9 ms · trigger init · 3 rows → columnFilters 0 0.4 ms → validity 0 0.0 ms → search 0 0.0 ms → sorting 0 0.1 ms → page 1/0 (0) · status idle · 0 open diagnostics
```

```text
row SKU-001 · data index 0 · run 1
  – schema        no schema
  ✗ columnFilters price range object → number fails   ← removed here
  · validity      not reached
  · search        not reached
  · sorting       not reached
  · pagination    not reached
  fix             setColumnFilter('price', undefined) or resetColumnFilters()
```

Read the first line left to right: the step where the count drops to `0` is the cause. The line
ends with the `status`: anything but `idle` means the table is still loading or failed — see
[the loading state never ends](loading-never-ends.md). `<DataTable />` shows the same status on
its root element as `data-status`, with `data-initial-load`.

| The count drops to 0 at | Cause |
|---|---|
| `columnFilters`, `validity` or `search` | [a filter or a search query hides every row](#a-filter-or-a-search-hides-every-row) |
| `schema … (n dropped)` | [the schema dropped the rows](#the-schema-dropped-the-rows) |
| the first number is `0 rows` | [the table has no data](#the-table-has-no-data) |

## A filter or a search hides every row

Likely causes: a filter or a query restored from the URL or from storage (`initialState`), a
filter left over from an earlier view, or a filter value of the wrong type
([`DK_FILTER_TYPE_MISMATCH`](errors.md#dk_filter_type_mismatch): `'40'` for a `range`). The Empty
state of `<DataTable />` receives `filtered: true` in this case: there is data, but no row
matches.

**Fix:** give the user a way back. `totalCount` counts the rows after ingest and `filteredCount`
the rows after the filters and the search:

```tsx
import { DataTable, useDataTable } from 'datakable/react'

type Product = { sku: string; name: string; price: number }

export function Products({ products }: { products: Product[] }) {
  const table = useDataTable({ data: products, rowKey: 'sku' })
  const { totalCount, filteredCount } = table.rowModel
  // There is data, but the filters or the search removed every row: offer a way back.
  const hidden = totalCount > 0 && filteredCount === 0
  return (
    <>
      {hidden && (
        <button
          type="button"
          onClick={() => {
            table.resetColumnFilters()
            table.clearSearch()
          }}
        >
          Clear filters and search
        </button>
      )}
      <DataTable table={table} />
    </>
  )
}
```

If a search should have matched, see [search finds nothing](search-finds-nothing-or-is-slow.md).

## The schema dropped the rows

With a `schema`, rows that fail it are dropped by default (`invalidRows: 'drop'`), each reported as
[`DK_SCHEMA_INVALID_ROW`](errors.md#dk_schema_invalid_row): the diagnostic names the field that
failed (`fix  1. 3 rows fail at "id" …`). `explain()` shows the drop as `schema 0 (3 dropped)`.

**Fix:** correct the data source or relax the schema at that field. To see the rows while you do,
keep them:

```ts
import { createTable, type StandardSchemaV1, withSchema } from 'datakable'

type User = { id: number; name: string }
declare const UserSchema: StandardSchemaV1<unknown, User> // zod, valibot, arktype, …
declare const json: unknown[]

const table = createTable({
  data: json,
  rowKey: 'id',
  schema: withSchema(UserSchema),
  // Keep the rows that fail the schema (row.valid === false) instead of dropping them.
  invalidRows: 'flag',
})

// Every invalid row, in every mode: its index in `data`, the raw value and the issues.
for (const { index, issues } of table.getInvalidRows()) console.warn(index, issues)
```

Flagged rows render with `data-invalid` / `aria-invalid` in `<DataTable />`, and `validity()`
filters them (`table.setValidity('invalid')`). A schema that throws instead of returning issues is
[`DK_SCHEMA_CRASHED`](errors.md#dk_schema_crashed).

## The table has no data

- **The option is not `data`.** The rows go in `data`; `rows`, `items` or `dataSource` are ignored.
  TypeScript rejects them, and development builds report
  [`DK_UNKNOWN_OPTION`](errors.md#dk_unknown_option):

```ts
import { createTable } from 'datakable'

type User = { id: number; name: string }
declare const users: User[]

// @ts-expect-error `rows` is not an option: the table has no data (DK_UNKNOWN_OPTION)
createTable({ rows: users })

createTable({ data: users }) // the rows go in `data`
```

- **The data comes from a `fetcher`.** Until the first request applies there are no rows: look at
  `status` (`fetching`, `pending` or `error`) and see
  [fetch errors and retries](fetch-errors-and-retries.md).
- **Server mode without a fetcher.** With `mode: 'server'` and no `fetcher`, the table shows the
  rows you pass as `data` (the current page) and nothing else: an empty `data` is an empty page.

## Related codes

[`DK_FILTER_TYPE_MISMATCH`](errors.md#dk_filter_type_mismatch) ·
[`DK_SCHEMA_INVALID_ROW`](errors.md#dk_schema_invalid_row) ·
[`DK_SCHEMA_CRASHED`](errors.md#dk_schema_crashed) ·
[`DK_UNKNOWN_OPTION`](errors.md#dk_unknown_option) ·
[`DK_FETCH_FAILED`](errors.md#dk_fetch_failed) ·
[`DK_INVALID_VALIDITY`](errors.md#dk_invalid_validity)

## See also

- [Debugging tools: `explain()` and `explainRow()`](errors.md#debugging-tools-explain-and-explainrow)
- [Sorting or filtering does nothing](sorting-or-filtering-does-nothing.md)
- Guides: [the row model](../how-to-use/core-concepts.md#the-row-model), [column
  filters](../how-to-use/column-filters.md), [how search
  works](../how-to-use/search.md#how-it-works), [schema
  validation](../how-to-use/schema-validation.md).
- [How to fix](README.md) — every symptom.
