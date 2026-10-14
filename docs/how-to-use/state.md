# State

This page covers the table's state: what is in it, how to read and change it, how to listen to
changes, how to start from given values with `initialState`, and how to own some slices yourself
(controlled state), for example to keep the sort in the URL.

## What is in the state

The state is an object with one **slice** per installed feature, named after the feature. Its type
is built from the features you installed, typed against your row type, so a slice of a feature you
did not install does not exist on the type.

| Slice | Type | Initial value | Feature |
| --- | --- | --- | --- |
| `columnFilters` | `ColumnFiltersState<T>` | `{}` | [Column filters](column-filters.md) |
| `validity` | `ValidityState` | `'all'` | [Validity](validity.md) |
| `search` | `SearchState` | `{ input: '', query: '', status: 'idle' }` | [Search](search.md) |
| `sorting` | `SortingState<T>` | `{ by: [] }` | [Sorting](sorting.md) |
| `pagination` | `PaginationState` | `{ pageIndex: 0, pageSize: 10 }` (or the `pageSize` option) | [Pagination](pagination.md) |

The rows themselves are not state: they are computed from the data and the state by the pipeline
and read with `getRowModel()` ([Core concepts](core-concepts.md#the-row-model)).

## Reading, changing and listening

- `getState()` returns the current **snapshot**. Snapshots are immutable (in development the
  snapshot and the plain objects and arrays in its slices are frozen, so a nested write throws a
  `TypeError`): a change creates a new snapshot, and a snapshot keeps the same reference until a
  slice changes, so you can compare slices with `===`.
- `setState(updater)` merges a partial state, or the result of `(prev) => partial`, slice by slice.
  A slice you pass replaces that slice; slices you leave out are kept.
- `subscribe(listener)` calls `listener(state, prev)` after each committed change and returns the
  unsubscribe function.

```ts
import { createTable } from 'datakable'

type User = { id: number; name: string; age: number }
declare const users: User[]

const table = createTable({ data: users, rowKey: 'id' })

const before = table.getState()
// One slice per installed feature: columnFilters, validity, search, sorting, pagination.
console.log(before.sorting.by, before.pagination) // [] { pageIndex: 0, pageSize: 10 }

// Listeners get the new snapshot and the previous one.
const unsubscribe = table.subscribe((state, prev) => {
  if (state.sorting !== prev.sorting) console.log('sort changed', state.sorting.by)
})

// A feature method is one update: one notification.
table.toggleSort('age')

// setState merges slices: a partial object, or a function of the current state.
table.setState({ pagination: { pageIndex: 0, pageSize: 50 } })
table.setState((s) => ({ pagination: { ...s.pagination, pageIndex: 1 } }))

console.log(before === table.getState()) // false: a new snapshot; `before` is unchanged
unsubscribe()
```

Prefer the feature methods (`toggleSort`, `setColumnFilter`, `setPageSize`, …) over `setState`:
they take one typed change instead of a whole slice, and they ignore invalid arguments with a
diagnostic. Either way, related slices follow in the same notification: a new filter or sort sends
the table back to page 0, for example.

How notifications work:

- **One per change.** A feature method that changes several things notifies once, when it returns.
- **The row model is ready.** When a listener runs, `getRowModel()` already reflects the state it
  receives.
- **Listeners are isolated.** A listener that throws is reported as
  [`DK_LISTENER_FAILED`](../how-to-fix/errors.md#dk_listener_failed); the other listeners still run.
- **Updates from listeners are allowed.** A listener may call `setState` or a feature method; the
  change is committed at once and notified in the next round. A chain of more than 50 such rounds
  is stopped and reported as [`DK_UPDATE_LOOP`](../how-to-fix/errors.md#dk_update_loop).
- **Status changes notify too.** A change of the row model's `status` or `isInitialLoad` (a
  request starting or finishing, for example) notifies even when the state did not change.

## Initial state

`initialState` sets the starting value of any slice; the other slices start from their feature's
initial value. It is read once, at creation.

```ts
import { createTable } from 'datakable'

type User = { id: number; name: string; age: number }
declare const users: User[]

// Starting values for some slices; the others start from their feature's initial state.
const table = createTable({
  data: users,
  rowKey: 'id',
  initialState: {
    sorting: { by: [{ id: 'age', desc: true }] },
    pagination: { pageIndex: 0, pageSize: 25 },
  },
})

console.log(table.getRowModel().rows.length) // up to 25, oldest first
```

A slice given in `initialState` replaces that feature's initial value as a whole (so
`initialState.pagination` takes precedence over `pagination({ pageSize })`). With server rendering,
`initialState` is how state parsed from the URL reaches the first render; see
[Server rendering (SSR)](ssr.md).

## Controlled state

Pass a slice in `state` to own it: the table then shows your value and asks you to change it
through `onStateChange` instead of changing it itself. Slices you do not pass (or pass as
`undefined`) stay owned by the table. Use it when another source of truth holds the value: the URL,
a router, a global store, or React state shared with other components.

`onStateChange(updater)` receives an updater that merges the changed slices into an object you
give it: call `updater({ sorting })` to get `{ sorting: next }`. The table does not apply the
change itself; it shows the new value once you feed it back.

With `createTable`, feed it back with `setOptions({ state })`:

```ts
import { createTable, type SortingState } from 'datakable'

type User = { id: number; name: string; age: number }
declare const users: User[]
declare function writeToUrl(sort: SortingState<User>): void

// You own the sorting slice: the table asks you to change it and shows what you feed back.
let sorting: SortingState<User> = { by: [] }

const table = createTable({
  data: users,
  rowKey: 'id',
  state: { sorting },
  onStateChange: (updater) => {
    const next = updater({ sorting })
    if (next.sorting) {
      sorting = next.sorting
      writeToUrl(sorting)
      table.setOptions({ state: { sorting } }) // feed it back
    }
  },
})

table.toggleSort('name') // → onStateChange → setOptions → the rows are sorted by name
```

`setOptions` replaces the whole `state` option: it is merged one level deep, like every option.
When you own several slices, pass all of them each time you feed one back. A slice left out of
`state` is no longer controlled: the table changes it on its own, without asking `onStateChange`,
and nothing is reported.

```ts
import { createTable, type PaginationState, type SortingState } from 'datakable'

type User = { id: number; name: string; age: number }
declare const users: User[]
declare function writeToUrl(state: object): void

// You own two slices. setOptions({ state }) replaces the whole `state` option, so pass every
// slice you own each time: a slice left out is released to the table.
let owned: { sorting: SortingState<User>; pagination: PaginationState } = {
  sorting: { by: [] },
  pagination: { pageIndex: 0, pageSize: 10 },
}

export const table = createTable({
  data: users,
  rowKey: 'id',
  state: owned,
  onStateChange: (updater) => {
    owned = { ...owned, ...updater(owned) } // the changed slices, merged into yours
    writeToUrl(owned)
    table.setOptions({ state: owned }) // every owned slice, not only the changed one
  },
})

table.toggleSort('name')
table.nextPage() // still asks onStateChange: pagination is still controlled
```

In React, keep the slice in `useState` and pass it as `state`; `useDataTable` syncs `state` on
every render, so setting your state is the feed-back:

```tsx
import { type PaginationState, useDataTable } from 'datakable'
import { useState } from 'react'

type User = { id: number; name: string }

export function Users({ users }: { users: User[] }) {
  // Own the pagination slice in React state; the table owns the rest.
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 })
  const table = useDataTable({
    data: users,
    rowKey: 'id',
    state: { pagination },
    onStateChange: (updater) => {
      const next = updater({ pagination })
      if (next.pagination) setPagination(next.pagination)
    },
  })
  return (
    <p>
      Page {pagination.pageIndex + 1} of {table.getPageCount()}
      <button type="button" onClick={table.nextPage} disabled={!table.canNextPage()}>
        Next
      </button>
    </p>
  )
}
```

`onStateChange` is called only for controlled slices; changes to the slices the table owns are
applied directly and reach you through `subscribe` (or a re-render in React).

## State types

Each feature exports the type of its slice. To name the whole state of a table, use the type of
`getState()`:

```ts
import {
  type ColumnFiltersState,
  createTable,
  type PaginationState,
  type SearchState,
  type SortingState,
  type ValidityState,
} from 'datakable'

type User = { id: number; name: string; age: number }
declare const users: User[]

const table = createTable({ data: users, rowKey: 'id' })

// The state type is built from the installed features, typed against User:
type State = ReturnType<typeof table.getState>
const state: State = table.getState()

const filters: ColumnFiltersState<User> = state.columnFilters
const validity: ValidityState = state.validity
const search: SearchState = state.search
const sorting: SortingState<User> = state.sorting
const pagination: PaginationState = state.pagination
console.log(filters, validity, search.query, sorting.by, pagination.pageSize)
```

## Pitfalls

- **A controlled slice without `onStateChange`** freezes the interactions that change it: the
  updates are dropped and reported as
  [`DK_CONTROLLED_WITHOUT_HANDLER`](../how-to-fix/errors.md#dk_controlled_without_handler). Pass
  `onStateChange`, or move the slice to `initialState` so the table owns it.
- **Feeding back one slice when you own several**: `setOptions({ state: { sorting } })` drops
  every other slice from `state`, which releases them to the table. Pass all the slices you own
  ([controlled state](#controlled-state)).
- **Not feeding the value back**: `onStateChange` alone does not change what the table shows. With
  `createTable`, call `setOptions({ state })` with the new value; in React, set the state you pass
  as `state`. An `onStateChange` that does not feed the value back freezes the slice; in
  development it is reported as
  [`DK_CONTROLLED_NOT_FED_BACK`](../how-to-fix/errors.md#dk_controlled_not_fed_back) — see
  [Sorting or filtering does nothing](../how-to-fix/sorting-or-filtering-does-nothing.md#the-state-is-controlled-and-not-fed-back).
- **A listener that always changes state** loops until the depth limit and reports
  [`DK_UPDATE_LOOP`](../how-to-fix/errors.md#dk_update_loop). Compare `state` with `prev` before updating.
- **A filter on a column that does not exist** (in `initialState`, controlled state or
  `setColumnFilter`) is ignored and reported as
  [`DK_STATE_UNKNOWN_KEY`](../how-to-fix/errors.md#dk_state_unknown_key).
- **Invalid slice values** written with `setState` are not trusted: an invalid pagination or
  validity value is replaced or ignored and reported
  ([`DK_INVALID_PAGINATION`](../how-to-fix/errors.md#dk_invalid_pagination),
  [`DK_INVALID_VALIDITY`](../how-to-fix/errors.md#dk_invalid_validity)).

## See also

- [Core concepts](core-concepts.md) — the table, the row model and the status model.
- [Features](features.md) — the slices and methods each feature adds.
- [React](react.md) — which `useDataTable` options are synced on every render.
- [`datakable` README: controlled state](../../packages/datakable/README.md#controlled-state)
- [Keep the table's state in the URL](../examples/url-state.md) — the recipe.
- [Sorting or filtering does nothing](../how-to-fix/sorting-or-filtering-does-nothing.md) and
  [endless re-renders](../how-to-fix/endless-re-renders.md) — troubleshooting controlled state.
