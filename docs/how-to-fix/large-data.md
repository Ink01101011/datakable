# Memory and speed with many rows

A table with tens of thousands of rows feels slow to type into, sort or page through, or uses
more memory than you expect. DataKable is built for large client-side tables, but a few patterns
make it redo work or keep everything in memory.

## Confirm: what is slow?

- **The tracer** (development) times every pipeline step: `String(table.explain())` prints them
  (`search 28 1.1 ms`), and a step over one task's budget (50 ms) reports
  [`DK_PERF_HINT`](errors.md#dk_perf_hint) with the step, the time and the row count. Time-sliced
  work counts too: a slice over 50 ms reports it (`a time slice of the "search" step took …`), and
  `explain()` after the work shows the step's total over its runs
  (`sorting 20000 2013.0 ms (sliced, 2 runs)`). In production, install it with
  `interceptors: [tracer()]`.
- **React renders:** the React profiler shows whether the time goes to DataKable's pipeline or to
  rendering rows.
- **Memory:** a heap snapshot; DataKable's own structures should be small next to your data.

## How DataKable handles size

- The pipeline passes row **indices** (`Uint32Array`) from step to step; `Row` objects are created
  for the visible page only.
- Column values are cached once per data array, only for the columns that filter, sort or search
  use (numbers as `Float64Array`), and released when the data array changes.
- The search matcher is built per data and columns, not per keystroke, and its work at large sizes
  is time-sliced (`status: 'pending'` meanwhile) so input stays responsive.
- Diagnostics keep the last 100; `getInvalidRows()` keeps indices and issues, not copies of rows.
- CI holds the pipeline's memory at 100,000 rows (without the data itself) to **5 MB** or less —
  paginated, unpaginated and searching.

## Fixes

- **Paginate.** Rendering 100,000 DOM rows is the slow part, not the pipeline. `pagination()` is
  in the default preset:

```ts
import { createTable } from 'datakable'

const readings = Array.from({ length: 100_000 }, (_, i) => ({
  id: i,
  sensor: `sensor-${i % 8}`,
  value: (i * 7919) % 1000,
}))

// The pipeline works on row indices; Row objects are created for the visible page only. With
// pagination() (in the default preset) that is one page of rows, whatever the data size.
export const table = createTable({ data: readings, rowKey: 'id' })
table.setPageSize(50)
console.log(table.getRowModel().rows.length, table.getRowModel().filteredCount)
```

- **Keep `data` the same array.** Every new array re-ingests the rows and rebuilds the column
  caches and the search matcher. In React, memoise derived data
  ([`DK_UNSTABLE_OPTION`](errors.md#dk_unstable_option); see
  [endless re-renders](endless-re-renders.md#unstable-options)). Never mutate the array in place
  either: the caches would be stale ([`DK_DATA_MUTATED`](errors.md#dk_data_mutated)); pass a new
  array when the data changes.
- **Search fewer columns**, and debounce typing:
  [search is slow](search-finds-nothing-or-is-slow.md#search-is-slow).
- **Make per-row callbacks cheap.** A `format`, `accessor`, custom filter `fn` or `sortFn` runs per
  row: precompute what you can (create `Intl` formatters once, outside the callback).
- **Let the server do it.** Past what the browser should hold (hundreds of thousands of rows, or
  rows you would download only to filter away), use `mode: 'server'` with a `fetcher`: the
  browser keeps one page.

## Related codes

[`DK_PERF_HINT`](errors.md#dk_perf_hint) ·
[`DK_SORT_STRATEGY`](errors.md#dk_sort_strategy) ·
[`DK_DATA_MUTATED`](errors.md#dk_data_mutated) ·
[`DK_UNSTABLE_OPTION`](errors.md#dk_unstable_option) ·
[`DK_ENV_FALLBACK`](errors.md#dk_env_fallback)

## See also

- [Search finds nothing, or is slow](search-finds-nothing-or-is-slow.md)
- [`@datakable/core` server mode](../../packages/core/README.md#server-mode)
- Guide: [performance](../how-to-use/performance.md).
- [Large data](../examples/large-data.md) — the recipe.
- [How to fix](README.md) — every symptom.
