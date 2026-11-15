# Search

`search()` is the table's global search: one query matched against several columns at once, with
fuzzy matching, search weights and relevance order. This page covers which columns are searched,
the `input` / `query` state, typing strategies (immediate, debounce, throttle, Enter), your own
matching with `withSearchFn`, and search on the server.

## How it works

Install `search()` (it is in the default preset of `datakable`; with `@datakable/core`, import it
from `@datakable/core/search`). `setSearch(q)` sets the query; the `search` step keeps the rows
that match it and orders them by relevance.

```ts
import { createTable } from '@datakable/core'
import { search } from '@datakable/core/search'

type User = { id: number; name: string; email: string; city: string; age: number }
declare const users: User[]

const table = createTable({
  data: users,
  rowKey: 'id',
  features: [search()],
  // Only columns with a `search` weight are searched once any column declares one.
  columns: [
    { key: 'name', search: 2 }, // a match here counts twice as much
    { key: 'email', search: 1 },
    { key: 'city', search: 0.5 },
    { key: 'age' }, // no weight: not searched
  ],
})

// Resolves when the query is applied, replaced by a newer one, or failed. Never rejects.
const { status } = await table.setSearch('mali')
console.log(status) // 'applied'

const { input, query } = table.getState().search
console.log(input, query) // 'mali' 'mali': the default typing strategy applies every keystroke
console.log(table.getRowModel().rows.map((row) => row.original.name)) // best match first

table.clearSearch() // empties input and query: every row again
```

- **Which columns.** When any column declares a `search` weight, only the columns with a weight
  above 0 are searched. When no column declares one (including zero-config columns), the columns
  of strings, numbers and booleans (nullable) are searched at weight 1. A column of dates, arrays
  or other objects is searched only with a `search` weight: formatting it would keep a string per
  row (see [Performance](performance.md)). Development builds report
  [`DK_SEARCH_COLUMN_SKIPPED`](../how-to-fix/errors.md#dk_search_column_skipped) for each such
  column, with the fix.
- **What is matched.** The formatted cell values: the column's `format`, else the default
  formatter (so a `Date` is matched as the user sees it, and arrays are joined). Matching is
  fuzzy (Levenshtein distance up to `fuzzyMaxDistance`) and case-insensitive unless
  `caseSensitive: true`. Cell values and the query are Unicode-normalised (NFC), like the
  `contains` filter, so a composed `Zoë` and a decomposed `Zoe` + `◌̈` (common from macOS, Thai and
  Vietnamese input) find each other. A one-word query is measured against each word of a cell as well as
  the whole cell, so `lopes` finds `Garcia Lopez`; a query with spaces is measured against the
  whole cell. A row is kept when its relevance (0–1, weights applied) reaches
  `threshold`.
- **Order.** Results come best match first (ties keep the input order). An active sort replaces
  that order: the pipeline runs `filter → search → sort → paginate`.
- **Blank queries.** The query is trimmed; a blank or whitespace-only query keeps every row.
- **Only the filtered rows** are matched: column filters and `validity` run first.
- **The search index** is built on the first non-blank query, once per data and `columns`
  reference, not per keystroke. On large data it is built in time slices: meanwhile the row model
  shows the previous rows with `status: 'pending'`.
- **New data re-matches only what changed.** With a query applied, `setData` with a new array
  builds the index again and reads each row's searched text once, but matches the query again only
  for rows whose text changed. A row keeps its score when its text hashes the same as the row at
  the same position, or at the position shifted by an insert or a delete, in the previous array.
  The hash is 53 bits wide (cyrb53): the chance that a changed row keeps a stale score is at most
  2·2⁻⁵³ (about 2·10⁻¹⁶) per changed row. Each row is hashed once per data array, on its first
  match; a new query on the same data hashes nothing.
  Row identity is never used, so a row object changed in place and passed in a new array is
  matched again. A one-row edit, an append, a prepend or the same rows in a new array
  (`data={rows.slice()}`) match at most the changed rows (19 ms instead of 57 ms for a one-row
  edit at 100k rows in our benchmark); reordering the rows re-matches the rows that moved. The
  scores of the last search are kept for this: 16 bytes per row (1.6 MB at 100k rows). A new query
  matches every row, except a narrowing one (next item). A `searchFn` runs again on new data. Changing a row object in place without passing a new
  array is not supported ([`DK_DATA_MUTATED`](../how-to-fix/errors.md#dk_data_mutated)); with search on, the kept scores and the kept
  words of each cell (next items) can then show stale hits until a new array arrives.
- **A longer query matches only the previous hits** when that provably gives the same rows: with
  `fuzzyMaxDistance: 0`, when the previous query (trimmed, NFC, case-folded unless `caseSensitive`)
  is inside the new one (`ad` → `ada`, `name 12` → `name 123`) and no column weight lets a row
  reach `threshold` on the new query while missing it on the previous one (ex-search's
  `canNarrow`). Typing on then matches only the rows still in the results (1 ms instead of 29 ms
  for `name 12` → `name 123` at 100k rows in our benchmark). Rows a filter hid from the previous
  search are matched when they come back. With fuzzy matching on (the default) a longer query can
  match rows the shorter one missed, so every row is matched again.
- **The words of each cell are found once per data array.** A one-word query with fuzzy matching
  on is measured against each word of a cell. The first one-word query on a data array finds the
  words of every cell it matches (in time slices, a block of rows at a time) and keeps them:
  ex-search's word index, the word offsets of each cell of two words or more, about 1 byte per
  word of such a cell (a cell of one word costs nothing). Later keystrokes split no cell again: a
  one-word keystroke over 100k rows of `name N` values takes about 56 ms instead of about 82 ms in
  2.1 in our benchmark. At 100k rows × 3 searched columns of short values the words take about 0.4
  MB. A new data array finds them again, on its first one-word query.
- **The kept words share a memory allowance.** The search state of a data array stays within 2
  MiB: 10 bytes per data row for the scores kept between keystrokes, up to 4 bytes per hit, and
  the kept words in what is left (about 0.66 MiB at 100k rows, 1.3 MiB at 50k, none from about
  150k rows). The rows whose words do not fit have them found again on every one-word keystroke,
  as in 2.1, with the same results. This keeps the §9.3 scenarios within 5 MB at 100k rows: for
  example filter + sort + a one-word query over 4 columns of two- or three-word text takes 4.35
  MB, over one 30-word column 4.54 MB. The gain per keystroke therefore depends on the text: at
  100k rows, about 31 % for one column of short values, 12–17 % for 4 columns of two- or
  three-word text, 15 % for 30-word cells and 4 % for 100-word cells, against 2.1. For long text at
  large row counts, [`fuzzyMaxRows`](#large-data) turns typo matching off: no words are found or
  kept at all.

## State

The `search` slice (`SearchState`):

| Field | Type | Description |
| --- | --- | --- |
| `input` | `string` | What the user typed; updates at once. Bind your input element to it. |
| `query` | `string` | The applied query: what the row model reflects. |
| `status` | `'idle' \| 'pending' \| 'searching' \| 'error'` | `pending`: a debounce or throttle is waiting to apply `input`. `searching`: a `searchFn` request is in flight. `error`: the last `searchFn` call failed. |
| `error` | `unknown` (optional) | The last `searchFn` failure, while `status` is `'error'`. |

`input` and `query` differ only while a typing strategy holds the input back (or with
`commitOn: 'enter'`). Typing alone (`input` changing) does not send pagination back to page 0;
a new applied `query` does.

## Options

`search(options)` (`SearchOptions`):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `threshold` | `number` (0–1) | `0.3` | Minimum relevance, weights applied, to keep a row. |
| `fuzzyMaxDistance` | `number` (integer ≥ 0) | `3` | Maximum Levenshtein distance of a fuzzy match. `0` turns fuzzy matching off: a one-word query is matched against whole cells only (no words are found or kept), so a keystroke costs less (about 26 ms instead of 65–75 ms at 100k rows in our benchmark), with the same results as matching each word, and a longer query matches only the previous hits (about 1 ms per keystroke at 100k rows). |
| `fuzzyMaxRows` | `number` (integer ≥ 0, or `Infinity`) | — (never; `Infinity` is the same) | Large data: when the data array has more rows than this (every row, before filters), matching runs as with `fuzzyMaxDistance: 0` — typos stop matching, no word index is kept. At or below it, `fuzzyMaxDistance` applies. See [Large data](#large-data). |
| `caseSensitive` | `boolean` | `false` | Match case. |
| `typing` | `SearchTyping` | immediate (client), see below (server) | When `query` follows `input`. |
| `mode` | `'client' \| 'server'` | `'client'` | `'server'`: the server matches the query; core skips this step. |
| `searchFn` | `AsyncSearchFn<T>` | — | Replaces the built-in matching. Wrap it with `withSearchFn()`. |

`threshold`, `fuzzyMaxDistance`, `fuzzyMaxRows` and `caseSensitive` have no effect with a `searchFn`, and
`searchFn` has none with `mode: 'server'` (both reported as `DK_OPTION_NO_EFFECT` in
development).

`typing` (`SearchTyping`):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `strategy` | `'immediate' \| 'debounce' \| 'throttle'` | `'immediate'` | `immediate`: every keystroke is applied. `debounce`: applied after `wait` without typing. `throttle`: at most once per `wait` (the first keystroke at once, the latest at the end of the window). |
| `wait` | `number` (ms) or `{ hours?, minutes?, seconds?, ms? }` | `300` | Used by `debounce` and `throttle`. |
| `behavior` | `'trailing' \| 'leading'` | `'trailing'` | Debounce only. `leading`: apply the first keystroke at once and drop the rest of the burst (`flushSearch()` applies them; otherwise their `setSearch()` promises resolve `'superseded'` when the silence window ends). |
| `minLength` | `number` (integer ≥ 0) | `0` | A trimmed input shorter than this is applied as an empty query (every row). |
| `commitOn` | `'type' \| 'enter'` | `'type'` | `enter`: typing only updates `input`; only `flushSearch()` applies it. |

With `mode: 'server'`, `typing` defaults to `{ strategy: 'debounce', minLength: 2 }` (wait
300 ms); what you pass overrides those fields.

```ts
import { createTable } from '@datakable/core'
import { search } from '@datakable/core/search'

type User = { id: number; name: string }
declare const users: User[]

const table = createTable({
  data: users,
  rowKey: 'id',
  features: [
    search({
      // Apply the query after 250 ms without typing; ignore inputs shorter than 2 characters.
      typing: { strategy: 'debounce', wait: { ms: 250 }, minLength: 2 },
    }),
  ],
})

void table.setSearch('ma') // input 'ma' at once; query follows after 250 ms
console.log(table.getState().search.status) // 'pending': the debounce is waiting
console.log(table.getRowModel().status) // 'pending' too

void table.flushSearch() // Enter: apply the current input now
table.cancelSearch() // or drop the waiting query; input and the applied query stay
```

## API

| Method | Description |
| --- | --- |
| `setSearch(query)` | Sets `input`, and `query` through the typing strategy. Returns `Promise<{ status }>`. |
| `flushSearch()` | Applies the current `input` now (Enter), dropping a scheduled commit. Returns `Promise<{ status }>`. |
| `cancelSearch()` | Drops a pending query (and aborts an in-flight `searchFn`); `input` and the applied `query` stay. |
| `clearSearch()` | Empties `input` and `query`: every row is shown again. |

The promises (`SearchOutcome`) resolve when the query is settled and **never reject**:
`'applied'` (the row model reflects it: on large data, after the time-sliced matching finishes and
the row model is no longer `'pending'`), `'superseded'` (a newer query, `cancelSearch()` or
`destroy()` replaced it) or `'error'` (`searchFn` failed). Still mark them handled (`void` or `await`) for your linter.

## A search input

Bind the element to `input`, not `query`, so typing stays responsive while a debounce waits.
`<DataTable />` renders this input for you (Enter = `flushSearch`, Esc = `clearSearch`).

```tsx
import { useDataTable } from 'datakable/react'

type User = { id: number; name: string }

export function UserSearch({ users }: { users: User[] }) {
  const table = useDataTable({ data: users, rowKey: 'id' })
  const { input, status } = table.state.search
  return (
    <div>
      <input
        type="search"
        aria-label="Search users"
        // Bind to `input` (what the user typed), not `query` (what is applied).
        value={input}
        onChange={(e) => void table.setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void table.flushSearch()
          else if (e.key === 'Escape') table.clearSearch()
        }}
      />
      {status === 'pending' || status === 'searching' ? (
        <span role="status">Searching…</span>
      ) : null}
      <p>{table.rowModel.filteredCount} matches</p>
    </div>
  )
}
```

## Your own matching: `searchFn`

A `searchFn` replaces the built-in matching, synchronous or asynchronous, for example a search
API. Wrap it with `withSearchFn()` from `@datakable/core/search-async` (also exported by
`@datakable/core` and `datakable`): the wrapper brings the async engine, which client search does
not bundle.

```ts
import { createTable } from '@datakable/core'
import { search } from '@datakable/core/search'
import { withSearchFn } from '@datakable/core/search-async'

type Product = { sku: string; name: string }
declare const products: Product[]

const table = createTable({
  data: products,
  rowKey: 'sku',
  features: [
    search({
      typing: { strategy: 'debounce', wait: 300 },
      // Your own matching, e.g. a search API. Wrapped with withSearchFn: client search alone
      // never bundles the async engine.
      searchFn: withSearchFn(async ({ query, signal }) => {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(query)}`, { signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        // The matching row keys (rowKey values) in relevance order, or the rows themselves.
        return { keys: (await res.json()) as string[] }
      }),
    }),
  ],
  timeout: 10_000, // a slower request is aborted: DK_ASYNC_TIMEOUT
})

const outcome = await table.setSearch('chair')
// 'applied'; 'superseded' if a newer query replaced it; 'error' if searchFn failed
// (DK_SEARCH_FAILED: the previous results stay, state.search.error holds the error).
console.log(outcome.status, table.getState().search.status)
```

- It is called with each applied non-blank query (`SearchFnContext`): `query` (trimmed), `rows`
  (the ingested data), `columns` (`options.columns`, empty when not given) and `signal`.
- It returns the matching rows (references from `rows`) or `{ keys }` (`rowKey` values; row
  indices without a `rowKey`), in relevance order. The result is intersected with the rows the
  filters kept.
- `{ keys }` compare as strings, like row keys everywhere else: `'2'` (an id from a JSON API)
  matches the row whose key is `2`. A repeated `rowKey` value stays the key of its first row only;
  later rows carry `key#1`, `key#2`, … (`row.key`, `DK_DUPLICATE_ROW_KEY`), so return those to
  match them. Keys that match no row are ignored and reported in development as
  [`DK_SEARCH_UNKNOWN_KEYS`](../how-to-fix/errors.md#dk_search_unknown_keys) (the count and a
  sample, redacted like row keys).
- While it runs, `status` is `'searching'` (in the slice and the row model) and the previous
  results stay on screen. New data runs it again for the applied query.
- Requests go through one async control: the latest query wins, a superseded request's `signal`
  is aborted and its result ignored, and `timeout` (table option, default 30 s) aborts a slow one
  with `DK_ASYNC_TIMEOUT`. An `AbortError` is not a failure.
- A throw or rejection keeps the previous results, sets `status: 'error'` with `error`, and
  reports `DK_SEARCH_FAILED`.
- In server rendering it does not run: the call waits for the client (see [SSR](ssr.md)).

## Search on the server

With `search({ mode: 'server' })`, core keeps the `search` slice but skips matching. The applied
`query` goes to the table's `fetcher`, or you read it from the state and fetch yourself. Server
steps must come first in the pipeline; see [Server mode](server-mode.md).

```ts
import { createTable, type FetchResult } from '@datakable/core'
import { search } from '@datakable/core/search'
import { withFetcher } from '@datakable/core/server'

type User = { id: number; name: string }

const table = createTable({
  rowKey: 'id',
  // The server matches the query: typing defaults to a 300 ms debounce and minLength 2.
  features: [search({ mode: 'server' })],
  fetcher: withFetcher(async ({ query, signal }) => {
    const res = await fetch(`/api/users?q=${encodeURIComponent(query ?? '')}`, { signal })
    return (await res.json()) as FetchResult<User>
  }),
})

void table.setSearch('mali') // fetches once the debounce applies the query
```

## Large data

Typo matching is what makes a one-word keystroke expensive on large data: each word of each cell
is measured against the query, and the words are kept (ex-search's word index). `fuzzyMaxRows`
turns it off for data above a row count you choose, so small tables keep typo matching and large
ones stay fast:

```ts
import { createTable } from '@datakable/core'
import { search } from '@datakable/core/search'

type Order = { id: number; customer: string; city: string }
declare const orders: Order[]

const table = createTable({
  data: orders,
  rowKey: 'id',
  // Up to 50,000 rows: typos match (fuzzyMaxDistance 3). Above: exact, prefix, substring only.
  features: [search({ fuzzyMaxRows: 50_000 })],
})

await table.setSearch('somchai') // finds "Somchai" at any size
await table.setSearch('somchia') // a typo: found up to 50,000 rows, not above
```

- **What changes above the limit.** The data is matched as with `fuzzyMaxDistance: 0`: a cell
  matches when it equals the query, starts with it or contains it (case-insensitive unless
  `caseSensitive`). A query with a typo (`somchia`) no longer matches. Exact, prefix and substring
  hits, their scores and their order are the same as without the option. No word index is kept,
  and a longer query matches only the previous hits (see above).
- **Which row count.** The rows of the data array (`data.length`), before filters: filtering does
  not switch typo matching back on, so results do not change while the user filters. New data
  (`setData`, `setOptions({ data })`) that crosses the limit is matched in its own mode from its
  first search; no score from the other mode is kept.
- **When it takes effect.** Development builds report
  [`DK_SEARCH_FUZZY_OFF`](../how-to-fix/errors.md#dk_search_fuzzy_off) (info) once per data
  array, on its first search, when the limit switches typo matching off.
- **Choosing a value.** At 100k rows (one searched column of `name N` values plus two numbers;
  Node on an Apple M-series laptop, no CPU throttle, production build, median of 5 processes),
  one-word keystrokes took about 54 ms with typo matching and 21 ms with `fuzzyMaxRows: 50_000`.
  The table's memory for filter + sort + a one-word query at 100k rows is 3.80 MB with typo
  matching and 2.63 MB above the limit (no word index). Pick the row count above which a keystroke feels slow on the devices your users have (a
  phone is several times slower than this laptop), and keep typo matching where your users rely
  on it (names, addresses). Omitted, typo matching stays on at every size, as before.

## Pitfalls

- **Nothing is searched.** When columns declare `search` weights but none is above 0, no column is
  searchable: every row is kept and `DK_OPTION_NO_EFFECT` is reported
  ([DK_OPTION_NO_EFFECT](../how-to-fix/errors.md#dk_option_no_effect)). Give the columns to search a weight,
  or remove every weight.
- **A raw function as `searchFn`.** It must be wrapped: `searchFn: withSearchFn(fn)`. An
  unwrapped one is a compile error and throws `DK_INVALID_OPTION` at `createTable()` in every
  build ([DK_INVALID_OPTION](../how-to-fix/errors.md#dk_invalid_option)).
- **`searchFn` failures** keep the old results; show `state.search.error` or watch for
  [DK_SEARCH_FAILED](../how-to-fix/errors.md#dk_search_failed) and
  [DK_ASYNC_TIMEOUT](../how-to-fix/errors.md#dk_async_timeout).
- **Binding the input to `query`.** With a debounce the input would lag or reset; bind it to
  `input`.
- **Expecting relevance order with a sort active.** Sorting runs after search; call
  `clearSorting()` to see relevance order.

## See also

- [Features](features.md) — the default preset and pipeline order.
- [Columns and row keys](columns-and-row-keys.md) — `search` weights and `format`.
- [Sorting](sorting.md) and [Pagination](pagination.md) — the steps after search.
- [Server mode](server-mode.md) — `fetcher` and the async statuses.
- [Core concepts](core-concepts.md) — the row model and `status`.
- [`@datakable/core` features](../../packages/core/README.md#features)
- [A headless table](../examples/headless-table.md) and [search through an
  API](../examples/async-search.md) — recipes.
- [Search finds nothing, or is slow](../how-to-fix/search-finds-nothing-or-is-slow.md) —
  troubleshooting.
- [Examples](../examples/README.md)
