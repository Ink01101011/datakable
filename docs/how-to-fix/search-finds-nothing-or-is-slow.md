# Search finds nothing, or is slow

The search box returns no rows for a value you can see in the table, returns them late, or makes
typing sluggish on a large table. Search in DataKable is fuzzy matching over the **formatted**
cell values (what the user sees) of the searchable columns; most problems come from which columns
are searchable and when the query is applied.

## Confirm: what was searched?

- `table.getState().search` (`table.state.search` in React) is `{ input, query, status }`:
  `input` is what was typed, `query` what the rows reflect. `input` ≠ `query` means the query is
  [not applied yet](#the-query-is-not-applied-yet).
- `String(table.explainRow(key))` for a row you expected: `✗ search  query (6 chars) did not
  match (threshold 0.3)` means the row was searched and did not match; check
  [which columns are searched](#the-column-is-not-searched).
- `status: 'error'` on the search state (and the row model): a `searchFn` failed —
  [`DK_SEARCH_FAILED`](errors.md#dk_search_failed).

## The query is not applied yet

The `typing` options of `search()` decide when `query` follows `input`: at once by default; after
a 300 ms debounce, and only from 2 characters, with `mode: 'server'`; only on `flushSearch()` with
`commitOn: 'enter'`. Until then the search state is `'pending'` and the rows are the previous
results. Code that reads the rows right after `setSearch()` reads them too early:

```ts
import { createTable, pagination, search, sorting } from 'datakable'

const users = [
  { id: 1, name: 'Ada', city: 'London' },
  { id: 2, name: 'Grace', city: 'New York' },
  { id: 3, name: 'Linus', city: 'Helsinki' },
]

export const table = createTable({
  data: users,
  rowKey: 'id',
  // The query applies 300 ms after the last keystroke (the default with mode: 'server').
  features: [search({ typing: { strategy: 'debounce', wait: 300 } }), sorting(), pagination()],
})

void table.setSearch('ada')
const { input, query, status } = table.getState().search
console.log(input, JSON.stringify(query), status, table.getRowModel().rows.length)

// Await setSearch() or flushSearch() (e.g. on Enter) before reading the searched rows.
await table.flushSearch()
console.log(table.getState().search.query, table.getRowModel().rows.length)
```

prints:

```text
ada "" pending 3
```

```text
ada 1
```

**Fix:** await the promise `setSearch()` / `flushSearch()` return (`{ status: 'applied' |
'superseded' | 'error' }`, never rejected), or render from the state and let it update. For a
query shorter than `minLength` the whole table is the expected result: the query is applied as
empty.

## The column is not searched

With no `search` weight on any column, every displayable column is searched at weight 1. As soon
as **one** column has a `search` weight, only the columns with a weight are searched. A column
added later without a weight is silently not searchable.

```ts
import { createTable } from 'datakable'

const users = [
  { id: 1, name: 'Ada', city: 'London', age: 36 },
  { id: 2, name: 'Grace', city: 'New York', age: 45 },
]

export const table = createTable({
  data: users,
  rowKey: 'id',
  // Once one column has a `search` weight, only the columns with a weight are searched.
  columns: [
    { key: 'name', search: 1 },
    { key: 'city', search: 0.5 }, // without a weight, 'London' would match nothing
    { key: 'age' },
  ],
})

await table.setSearch('London')
console.log(table.getRowModel().rows.map((row) => row.original.name))
```

prints:

```text
["Ada"]
```

Search matches the **formatted** value: a column with `format: (d) => d.toLocaleDateString()` is
searched as that text, not as the raw `Date`; an object column is searched through its `format`.

## The match is too strict

Matching is fuzzy and case-insensitive: a row is kept when its relevance (0–1, weight applied)
reaches `threshold` (default `0.3`), with up to `fuzzyMaxDistance` (default `3`) edits (per
word of the cell for a one-word query; against the whole cell for a query with spaces). A low
weight lowers a column's relevance. `explainRow(key)` prints the threshold the row missed and
suggests a lower one; `search({ threshold: 0.2 })` keeps weaker matches. `caseSensitive: true`
makes it stricter.

## Search is slow

Search builds a matcher over the searchable values once per data and columns, not per keystroke;
on a large table that build is time-sliced (`status: 'pending'` meanwhile), so input stays
responsive. When a step still takes longer than one task (50 ms), development builds report
[`DK_PERF_HINT`](errors.md#dk_perf_hint) with the step and the row count. To make it faster:

- **Search fewer columns.** Give a `search` weight to the columns worth searching (example
  above); ids, numbers and long text columns cost time and rarely help.
- **Type less often.** `search({ typing: { strategy: 'debounce', wait: 300 } })` applies the
  query once the user pauses.
- **Keep `data` stable.** A new `data` array rebuilds the matcher; in React, memoise derived data
  ([`DK_UNSTABLE_OPTION`](errors.md#dk_unstable_option)).
- **Search on the server.** `search({ mode: 'server' })` with a `fetcher` sends `query` to your
  API; or keep the rows in the browser and pass a `searchFn` (wrapped with `withSearchFn()`) backed
  by a search service.

## Related codes

[`DK_SEARCH_FAILED`](errors.md#dk_search_failed) ·
[`DK_PERF_HINT`](errors.md#dk_perf_hint) ·
[`DK_UNSTABLE_OPTION`](errors.md#dk_unstable_option) ·
[`DK_OPTION_NO_EFFECT`](errors.md#dk_option_no_effect) (a `search` with no searchable column)

## See also

- [The table shows no rows](no-rows.md)
- [Memory and speed with many rows](large-data.md)
- [`@datakable/core` features](../../packages/core/README.md#features) — the `search()` options.
- Guides: [how search works](../how-to-use/search.md#how-it-works), [your own matching:
  `searchFn`](../how-to-use/search.md#your-own-matching-searchfn).
- [Search through an API](../examples/async-search.md) — the recipe.
- [How to fix](README.md) — every symptom.
