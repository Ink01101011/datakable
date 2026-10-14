# Large data: 100,000 rows on the client

DataKable is built for large client-side tables: values are read once per column, only the visible
page becomes row objects, and long work is time-sliced so the page keeps responding. A few habits
in your code keep it that way. This recipe shows them on a 100k-row table.

## Goal

Show 100,000 trades with search, sorting, column filters and pagination that stay responsive on
a mid-range laptop and a low-end phone.

## The code

```tsx
import {
  type ColumnDef,
  columnFilters,
  DataTable,
  pagination,
  search,
  sorting,
} from 'datakable/react'
import type { ReactNode } from 'react'

export type Trade = { id: number; symbol: string; side: 'buy' | 'sell'; qty: number; at: Date }

// Stable references: columns and features outside the component, `trades` kept as one array
// (not re-created with .map/.filter on every render, which would re-ingest 100k rows).
const columns: ColumnDef<Trade, ReactNode>[] = [
  { key: 'symbol', header: 'Symbol', search: 1 }, // only weighted columns are searched
  { key: 'side', header: 'Side' },
  { key: 'qty', header: 'Quantity' },
  { key: 'at', header: 'Time', format: (at) => at.toISOString().slice(11, 19) },
]
const features = [
  columnFilters(),
  // Search when typing pauses, not on every keystroke over 100k rows.
  search({ typing: { strategy: 'debounce', wait: 200 } }),
  sorting(),
  pagination({ pageSize: 50 }), // only the visible page becomes Row objects and DOM rows
]

export function TradesTable({ trades }: { trades: Trade[] }) {
  return <DataTable data={trades} rowKey="id" columns={columns} features={features} />
}
```

## What you will see

- The first page of 50 rows at once, with `Page 1 of 2000`.
- Typing in the search box applies 200 ms after the last keystroke. The first search builds the
  search index over the weighted columns, once per data and columns; while it is built or a long
  sort runs, the table shows "Updating…" over the current rows (`status: 'pending'`) and the page
  keeps responding.
- Sorting by quantity or time is a numeric sort (dates sort by their time value); sorting by symbol
  compares strings with `Intl.Collator`, which is the slowest kind and is time-sliced on large
  data.

## Tips

- **Keep references stable.** `data`, `columns` and `features` are compared by reference: a new
  array on every render re-ingests the data or rebuilds the column cache. In development,
  [`DK_UNSTABLE_COLUMNS`](../how-to-fix/errors.md#dk_unstable_columns) / [`DK_UNSTABLE_OPTION`](../how-to-fix/errors.md#dk_unstable_option) warn when that happens. Memoise derived data
  (`useMemo(() => trades.filter(…), [trades])`), and to change the data pass a new array: mutating
  it in place is not seen ([`DK_DATA_MUTATED`](../how-to-fix/errors.md#dk_data_mutated)).
- **Search fewer columns.** Give `search` weights to the columns worth searching; the others are not
  indexed. Debounce typing (`typing: { strategy: 'debounce' }`) so one search runs per pause, not
  per keystroke.
- **Paginate.** Only the current page is turned into `Row` objects and DOM rows. A page size in the
  tens keeps rendering cheap; for one long scrolling list, render the rows of `table.rowModel`
  through a virtualizer instead of a pager.
- **Cheap sort keys.** Sorting is fastest on numbers and dates. For strings that are
  really codes or categories, `sortBy: (t) => rank[t.symbol]` gives a numeric key.
  `sorting({ algorithm })` or a column's `sortAlgorithm` forces an algorithm when the automatic
  choice is slower for your data; `sorting({ debug: true })` reports the choice
  ([`DK_SORT_STRATEGY`](../how-to-fix/errors.md#dk_sort_strategy)).
- **Measure.** `String(table.explain())` shows rows and time per step of the last run (traced in
  development), and in development a step over 50 ms is reported as [`DK_PERF_HINT`](../how-to-fix/errors.md#dk_perf_hint).
- **Past the client's limits** (millions of rows, or data you should not ship): move the work to
  the server with `mode: 'server'` and a `fetcher` ([Server-side table](server-side-table.md)).

## See also

- [Status model](../../packages/core/README.md#status-model) — what `pending` means.
- [explain()](../../packages/core/README.md#explain-and-explainrow) in `@datakable/core`.
- [Performance](../how-to-use/performance.md) and [Diagnostics](../how-to-use/diagnostics.md) — the
  guides.
- [Memory and speed with many rows](../how-to-fix/large-data.md) — troubleshooting.
- [Examples](README.md)
