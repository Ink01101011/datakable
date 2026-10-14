# Sorting

`sorting()` orders the rows by one or more columns. This page covers the sort state and API
(`toggleSort`, multi-column sort, `aria-sort`), how values compare, per-column `sortFn` / `sortBy`,
the sort algorithms, and sorting on the server.

## How it works

Install `sorting()` (in the default preset of `datakable`; with `@datakable/core`, import it from
`@datakable/core/sorting`). The `sorting` slice is a list of entries, first key first; an empty
list keeps the input order (or search relevance).

```ts
import { createTable } from '@datakable/core'
import { sorting } from '@datakable/core/sorting'

type User = { id: number; name: string; age: number; city: string }
declare const users: User[]

const table = createTable({ data: users, rowKey: 'id', features: [sorting()] })

table.toggleSort('age') // by: [{ id: 'age', desc: false }]
table.toggleSort('age') // by: [{ id: 'age', desc: true }]
table.toggleSort('age') // by: []: back to the input order

table.toggleSort('city')
table.toggleSort('name', { multi: true }) // city, then name: [{ city asc }, { name asc }]
console.log(table.getSortDirection('name')) // 'asc'; false for a column not in the sort

table.setSorting([{ id: 'age', desc: true }]) // replace the whole sort
table.clearSorting()
console.log(table.getState().sorting.by) // []
```

- `toggleSort(id)` cycles that column **asc → desc → none** and makes it the only sort key.
- `toggleSort(id, { multi: true })` (Shift+click) keeps the other keys: a new column is appended,
  a column already in the sort cycles in place, and one at `desc` is removed.
- Column ids are dot-paths of the row type, checked at compile time. A column that is not in
  `columns` (zero-config, or a path you did not list) sorts by its path value.
- Sorting never touches your data: it orders a copy of the row indices, and the order is stable
  (equal rows keep their input order).
- It runs after filters and search, so an active sort replaces search relevance order. A change of
  the sort sends pagination back to page 0 (`autoResetPageIndex`).

## State and API

The `sorting` slice (`SortingState<T>`) is `{ by: readonly SortEntry<T>[] }`, with
`SortEntry<T> = { id: Path<T>; desc: boolean }`.

| Method | Description |
| --- | --- |
| `toggleSort(id, options?)` | Cycles `id` asc → desc → none. `options.multi`: keep the other entries (append, cycle in place, or remove). |
| `setSorting(by)` | Replaces the whole sort with `by` (`SortEntry<T>[]`). |
| `clearSorting()` | Removes every entry: input order. |
| `getSortDirection(id)` | `'asc'`, `'desc'`, or `false` when `id` is not in the sort (for `aria-sort`). |

A sortable header with `aria-sort` and Shift+click:

```tsx
import { useDataTable } from 'datakable/react'

type User = { id: number; name: string; age: number }

const ARIA = { asc: 'ascending', desc: 'descending' } as const

export function UserTable({ users }: { users: User[] }) {
  const table = useDataTable({ data: users, rowKey: 'id' })
  const header = (id: 'name' | 'age', label: string) => {
    const dir = table.getSortDirection(id)
    return (
      <th aria-sort={dir ? ARIA[dir] : 'none'}>
        {/* Shift+click adds the column to the sort instead of replacing it. */}
        <button type="button" onClick={(e) => table.toggleSort(id, { multi: e.shiftKey })}>
          {label}
          {dir === 'asc' ? ' ▲' : dir === 'desc' ? ' ▼' : ''}
        </button>
      </th>
    )
  }
  return (
    <table>
      <thead>
        <tr>
          {header('name', 'Name')}
          {header('age', 'Age')}
        </tr>
      </thead>
      <tbody>
        {table.rowModel.rows.map((row) => (
          <tr key={row.key}>
            <td>{row.original.name}</td>
            <td>{row.original.age}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

## How values compare

The default comparator, per entry:

- **Missing values last.** `null`, `undefined`, `NaN` and invalid `Date`s go after every other
  value in both directions.
- **Type rank first** in mixed columns: numbers (and bigints) < `Date`s < strings < booleans <
  everything else (objects, arrays: equal to each other, so they keep their order).
- **Strings** compare with one `Intl.Collator(locale, { numeric: true })`, so `'item 2'` comes
  before `'item 10'`. `locale` defaults to `'en'`, not the runtime's, so a server-rendered table
  sorts the same in every browser; an unsupported one falls back with `DK_ENV_FALLBACK` (info).
- Numbers, bigints and dates by value; `false` before `true`.

Per column you can replace it:

| Column field | Type | Description |
| --- | --- | --- |
| `sortFn` | `(a: V, b: V) => number` | Compares two values of the column (typed as its value). Missing values still go last. |
| `sortBy` | `(row: T) => Primitive` | Sorts by a key computed from the row, compared with the default comparator. Takes precedence over `sortFn`. |
| `sortAlgorithm` | `SortAlgorithm` | The algorithm when this column is the first sort key (overrides `sorting({ algorithm })`). |
| `sortable` | `boolean` | `false` hides the sort button in `<DataTable />`. On an object column, `true` requires `sortFn` or `sortBy`. |

An object, function or array-of-objects column has no default order: to make it sortable, set
`sortable: true` with `sortFn` or `sortBy` (a compile error otherwise).

```ts
import { createTable } from '@datakable/core'
import { sorting } from '@datakable/core/sorting'

type Task = {
  id: number
  title: string
  priority: 'low' | 'medium' | 'high'
  owner: { name: string; team: string }
  created: Date
}
declare const tasks: Task[]

const RANK = { low: 0, medium: 1, high: 2 }

const table = createTable({
  data: tasks,
  rowKey: 'id',
  features: [sorting()],
  columns: [
    { key: 'title' },
    // sortFn compares two values of the column (typed as the column's value).
    { key: 'priority', sortFn: (a, b) => RANK[a] - RANK[b] },
    // An object column has no default order: `sortable: true` needs sortBy (or sortFn).
    { key: 'owner', format: (o) => o.name, sortable: true, sortBy: (task) => task.owner.team },
    // Force an algorithm for this column (here: its timestamps are mostly in order already).
    { key: 'created', sortAlgorithm: 'tim' },
  ],
})

table.toggleSort('priority')
```

## Options

`sorting(options)` (`SortingOptions`):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `locale` | `string \| readonly string[]` | `'en'` | BCP 47 locale(s) of the string collator, e.g. `'th'` or `['th', 'en']`. |
| `algorithm` | `'auto' \| 'tim' \| 'radix' \| 'counting' \| 'native' \| (indices, compare) => Uint32Array` | `'auto'` | How the row indices are sorted. A column's `sortAlgorithm` takes precedence. |
| `debug` | `boolean` | `false` | Report each sort as `DK_SORT_STRATEGY` (info): algorithm, reason, n, time. |
| `mode` | `'client' \| 'server'` | `'client'` | `'server'`: the server sorts; core skips this step. |

```ts
import { createTable } from '@datakable/core'
import { sorting } from '@datakable/core/sorting'

type City = { id: number; name: string; population: number }
declare const cities: City[]

const table = createTable({
  data: cities,
  rowKey: 'id',
  features: [
    sorting({
      locale: 'th', // strings compare with Intl.Collator('th', { numeric: true })
      debug: true, // reports DK_SORT_STRATEGY (info): the algorithm chosen, why, n and the time
      // A custom algorithm sorts the row indices with the comparator DataKable built
      // (it must return a Uint32Array of the same length; typed-array sort is stable).
      algorithm: (indices, compare) => indices.sort(compare),
    }),
  ],
})

table.toggleSort('name')
```

### Algorithms

Every algorithm gives the same stable order; they differ in speed. `'auto'` chooses per sort from
one scan of the keys:

- A single column of safe-integer keys (numbers, `Date`s) with the default comparator: `tim` when
  nearly sorted, `counting` when the key range is at most 4 × n (and at most 1,000,000), `radix`
  for a wide range from 10,000 rows, `tim` otherwise.
- Strings, floats, several sort keys or a `sortFn`: `native` (`Array.prototype.sort`, stable).
- From 10,000 rows, a string column is first turned into collation ranks (integer keys) by a
  time-sliced job; meanwhile the row model shows the previous order with `status: 'pending'`.

A named algorithm forces it: `radix` and `counting` need a single column of safe-integer keys and
fall back to `auto` otherwise (`DK_OPTION_NO_EFFECT`). A function receives a copy of the row
indices and a comparator over them, and returns the sorted `Uint32Array` of the same length; if it
throws or returns anything else, the rows are sorted with `native`.

## Sorting on the server

With `sorting({ mode: 'server' })`, core keeps the slice but does not sort. The entries go to the
table's `fetcher` as `sort` (`{ id, desc }[]`, first key first), or you read them from the state
and fetch yourself. Server steps must come first; see [Server mode](server-mode.md).

## Pitfalls

- **Typos and object columns are compile errors.** `toggleSort('nmae')` does not compile, and
  neither does `sortable: true` on an object column without `sortFn` / `sortBy`
  ([Reading type errors](../how-to-fix/reading-type-errors.md)).

```ts
import { createTable } from '@datakable/core'
import { sorting } from '@datakable/core/sorting'

type User = { id: number; name: string; address: { city: string } }
declare const users: User[]

const table = createTable({
  data: users,
  features: [sorting()],
  columns: [
    { key: 'name' },
    // @ts-expect-error an object column with sortable: true needs sortFn or sortBy
    { key: 'address', format: (a) => a.city, sortable: true },
  ],
})

// @ts-expect-error 'nmae' is not a path of User
table.toggleSort('nmae')
```

- **An inconsistent `sortFn`.** In development, a sample of values is checked: a `sortFn` that
  returns `NaN`, a non-number, or disagrees with itself when the arguments swap is reported as
  [DK_SORT_COMPARATOR_INVALID](../how-to-fix/errors.md#dk_sort_comparator_invalid) and the column falls back
  to the default comparator.
- **A throwing `sortFn` or `sortBy`.** Reported as
  [DK_CALLBACK_FAILED](../how-to-fix/errors.md#dk_callback_failed): a throwing `sortFn` falls back to the
  default comparator, a row whose `sortBy` throws sorts last.
- **Why this algorithm?** Turn on `sorting({ debug: true })` and read
  [DK_SORT_STRATEGY](../how-to-fix/errors.md#dk_sort_strategy).
- **`setSorting` with the same sort written in another key order.** An equal sort keeps the slice
  (no notification, no page reset), but entries are compared as JSON, so key order matters:
  `{ desc: false, id: 'name' }` is a change after `{ id: 'name', desc: false }`, which notifies and
  sends the table back to page 0 (`autoResetPageIndex`). Write entries as `{ id, desc }`.
- **Sort seems to do nothing in server mode.** Core does not sort there: your fetcher (or your own
  request) must apply `sort`.

## See also

- [Features](features.md) — the default preset and pipeline order.
- [Columns and row keys](columns-and-row-keys.md) — column fields and dot-paths.
- [Search](search.md) — relevance order, which a sort replaces.
- [Pagination](pagination.md) — page reset on sort change.
- [Server mode](server-mode.md)
- [Performance](performance.md) — sorting large data.
- [`@datakable/core` features](../../packages/core/README.md#features)
- [A headless table](../examples/headless-table.md) and [state in the URL](../examples/url-state.md)
  — recipes.
- [Sorting or filtering does nothing](../how-to-fix/sorting-or-filtering-does-nothing.md) —
  troubleshooting.
- [Examples](../examples/README.md)
