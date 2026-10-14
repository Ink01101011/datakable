# Custom columns: formatting, cell renderers, nested values

Columns decide what each cell shows: a header, a formatted string, or any React content. This
recipe declares typed columns for an orders table with nested values, currency and dates, a badge
renderer and a derived column.

## Goal

Show orders with readable headers, money and dates formatted for the locale, the status as a
styled badge, a nested customer name, and a computed summary column; keep the customer's email out
of diagnostics.

## The code

```tsx
import { type ColumnDef, DataTable } from 'datakable/react'
import type { ReactNode } from 'react'

export type Order = {
  id: string
  customer: { name: string; email: string }
  total: number
  status: 'paid' | 'pending' | 'refunded'
  placedAt: Date
  tags: string[]
}

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const day = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' })

// Typed against Order: a key that is not a dot-path of Order, or a `format` that takes the wrong
// value type, is a compile error. Define columns outside the component (or memoise them).
const columns: ColumnDef<Order, ReactNode>[] = [
  { key: 'id', header: 'Order' },
  { key: 'customer.name', header: 'Customer', search: 2 }, // a nested value; search weight 2
  { key: 'customer.email', header: 'Email', search: 1, sensitive: true }, // never in diagnostics
  { key: 'total', header: 'Total', format: (total) => money.format(total) },
  {
    key: 'status',
    header: 'Status',
    // A cell renderer returns any ReactNode; `value` is typed 'paid' | 'pending' | 'refunded'.
    cell: ({ value }) => <mark data-order-status={value}>{value}</mark>,
  },
  { key: 'placedAt', header: 'Placed', format: (date) => day.format(date) },
  { key: 'tags', header: 'Tags', sortable: false }, // arrays of primitives are joined
  // A derived column: an `id` and an `accessor` instead of a `key`.
  { id: 'summary', header: 'Summary', accessor: (o) => `${o.tags.length} tags, ${o.status}` },
]

export function OrdersTable({ orders }: { orders: Order[] }) {
  return <DataTable data={orders} rowKey="id" columns={columns} caption="Orders" />
}
```

## What you will see

- Eight columns, in the order of `columns`, with the given headers: Order, Customer, Email, Total,
  Status, Placed, Tags, Summary.
- `1234.5` shows as `$1,234.50`, and the date as `Oct 1, 2026`.
- The status cell is a `<mark data-order-status="paid">` you can style per value.
- `tags` (an array of strings) shows as `gift, express`: the default formatter joins arrays of
  primitives. Its header is not a sort button (`sortable: false`).
- Summary is computed from each row (`2 tags, paid`) and can be sorted like any other column.
- Search matches the customer name and email only: once any column has a `search` weight, only
  weighted columns are searched. Results are ordered by relevance (until you sort), and a match in
  a higher-weighted column scores higher.
- Sorting a formatted column still sorts by the value (`total` as a number, `placedAt` as a date),
  not by the formatted text.

## Variations

- **Type safety:** `{ key: 'customer.nmae' }` or `format: (total: string) => …` is a compile
  error. A column whose value is an object (say `key: 'customer'`) must have `format` or `cell`,
  because the default formatter cannot display it.
- **Sort by something else:** `sortBy: (order) => order.customer.name.toLowerCase()` or
  `sortFn: (a, b) => …` on the column.
- **Filter a column:** with the default preset, `table.setColumnFilter('total', { type: 'range',
  value: { min: 100 } })`; the filter kinds a column accepts follow its value type.
- **No React:** `ColumnDef<Order>` (without `ReactNode`) works with `createTable`; `cell` then
  returns whatever your renderer uses.

## See also

- [Columns](../../packages/core/README.md#columns) — every column field.
- [How to fix](../how-to-fix/README.md) — the type errors a wrong column produces.
- [Columns and row keys](../how-to-use/columns-and-row-keys.md) — the guide to every column field.
- [Examples](README.md)
