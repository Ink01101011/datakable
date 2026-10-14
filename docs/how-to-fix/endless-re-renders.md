# Endless re-renders or a frozen page

The component re-renders without stopping, the tab freezes, React reports "Too many re-renders" /
"Cannot update a component while rendering a different component", or DataKable reports
[`DK_UPDATE_LOOP`](errors.md#dk_update_loop) or
[`DK_LISTENER_FAILED`](errors.md#dk_listener_failed). Something updates the table in reaction to
the table's own update.

## Confirm: who updates the table?

- A React component that calls a table method (`setColumnFilter`, `setSorting`, `setPageIndex`,
  `setSearch`, …) in its body, outside an event handler or an effect:
  [an update while rendering](#a-table-update-while-rendering).
- A `table.subscribe(…)` listener that changes the state on every notification:
  [an update in a listener](#an-update-in-a-listener) — `DK_UPDATE_LOOP`.
- New `columns` / `data` / `fetcher` references on every render are not a loop in DataKable, but
  they make every render redo work: [unstable options](#unstable-options) —
  [`DK_UNSTABLE_COLUMNS`](errors.md#dk_unstable_columns) /
  [`DK_UNSTABLE_OPTION`](errors.md#dk_unstable_option) in development.

## A table update while rendering

Every table update notifies the component, which renders again; a method called in the body runs
again on that render, with a new value (a new array or object is a new value), and so on. React
also reports the update of a component while another renders, which DataKable reports as
[`DK_LISTENER_FAILED`](errors.md#dk_listener_failed).

**Fix:** set the first value with `initialState` (or `state`), and apply later changes in an
effect or an event handler:

```tsx
import { useDataTable } from 'datakable/react'
import { useEffect } from 'react'

type Order = { id: number; customer: string; status: string }

export function Orders({ orders, status }: { orders: Order[]; status: string }) {
  const table = useDataTable({
    data: orders,
    rowKey: 'id',
    // The first value, at creation.
    initialState: { columnFilters: { status: { type: 'equals', value: status } } },
  })
  // Table methods keep their identity across renders; the returned object does not.
  const { setColumnFilter } = table
  // Later changes: after the render, not while rendering — a table update during render
  // re-renders the component, which updates the table again, and so on.
  useEffect(() => {
    setColumnFilter('status', { type: 'equals', value: status })
  }, [setColumnFilter, status])
  return <p>{table.rowModel.filteredCount} orders</p>
}
```

## An update in a listener

A listener that changes the state is called again for its own change. DataKable stops the chain
after 50 rounds and drops the update ([`DK_UPDATE_LOOP`](errors.md#dk_update_loop)), so the page
does not hang, but the state is not what you wanted.

**Fix:** update only when the value differs, or derive the value instead of storing it:

```ts
import { createTable } from 'datakable'

const users = [
  { id: 1, name: 'Ada', city: 'London' },
  { id: 2, name: 'Grace', city: 'New York' },
]

export const table = createTable({ data: users, rowKey: 'id' })

// Always break ties by name. Update only when the rule is not met yet: an unconditional update
// notifies this listener again, forever (DK_UPDATE_LOOP stops it after 50 rounds).
table.subscribe((state) => {
  const by = state.sorting.by
  if (by.length > 0 && by.at(-1)?.id !== 'name') {
    table.setSorting([...by, { id: 'name', desc: false }])
  }
})

table.toggleSort('city')
console.log(table.getState().sorting.by)
```

prints:

```text
[{"id":"city","desc":false},{"id":"name","desc":false}]
```

## Unstable options

`useDataTable` compares `columns`, `data` and a `rowKey` function by reference. In a re-render
the table itself caused, it keeps the columns and data it already has, so inline values never
loop — but every render from your side re-ingests the data or rebuilds the column cache. Read-once
options (`features`, `schema`, …) are never recreated: a new inline `features` array is ignored,
and a new function inside it (`search({ searchFn })`) keeps running the first one.

**Fix:** create columns and features once, outside the component (or with `useMemo`), and memoise
derived data:

```tsx
import { type ColumnDef, useDataTable } from 'datakable/react'
import { type ReactNode, useMemo } from 'react'

type User = { id: number; name: string; age: number }

// Created once, outside the component.
const columns: ColumnDef<User, ReactNode>[] = [{ key: 'name' }, { key: 'age' }]

export function Adults({ users, minAge }: { users: User[]; minAge: number }) {
  // A new array only when the inputs change, not on every render.
  const adults = useMemo(() => users.filter((user) => user.age >= minAge), [users, minAge])
  const table = useDataTable({ data: adults, rowKey: 'id', columns })
  return <p>{table.rowModel.filteredCount} adults</p>
}
```

An inline `fetcher`, `onStateChange` or `onDiagnostic` is fine: the table always calls the latest
one, and a new reference does not refetch — call `table.refetch()` when a value the fetcher reads
changes.

## Related codes

[`DK_UPDATE_LOOP`](errors.md#dk_update_loop) ·
[`DK_LISTENER_FAILED`](errors.md#dk_listener_failed) ·
[`DK_UNSTABLE_COLUMNS`](errors.md#dk_unstable_columns) ·
[`DK_UNSTABLE_OPTION`](errors.md#dk_unstable_option) ·
[`DK_CONTROLLED_WITHOUT_HANDLER`](errors.md#dk_controlled_without_handler)

## See also

- [`@datakable/react`](../../packages/react/README.md#usedatatable) — which options are read once
  and which are synced.
- [Sorting or filtering does nothing](sorting-or-filtering-does-nothing.md) — controlled state.
- Guides: [options read once and synced](../how-to-use/react.md#options-read-once-and-synced),
  [state](../how-to-use/state.md).
- [How to fix](README.md) — every symptom.
