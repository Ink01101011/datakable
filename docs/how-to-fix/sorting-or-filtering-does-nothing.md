# Sorting or filtering does nothing

You click a sort header, call `toggleSort()` or set a filter, and the rows stay as they were. This
page lists the causes, and how to tell them apart.

## Confirm: did the state change?

Read the state right after the call, and the last pipeline run:

- `table.getState().sorting` (`table.state.sorting` in React) / `.columnFilters`: if it did **not**
  change, the update was dropped — the state is
  [controlled and not fed back](#the-state-is-controlled-and-not-fed-back).
- If it changed but the rows did not, `String(table.explain())` shows each step: a step printed as
  `sorting (server)` is [in server mode](#the-feature-is-in-server-mode) and does not run in the
  browser.
- If the method does not exist (TypeScript: `Property 'toggleSort' does not exist`), or
  `<DataTable />` shows no sort buttons or no search box, [the feature is not
  installed](#the-feature-is-not-installed).

## The state is controlled and not fed back

`state: { sorting }` makes you the owner of that slice: the table asks for a change through
`onStateChange` and shows only what you pass back in `state`. Without `onStateChange` the table
reports [`DK_CONTROLLED_WITHOUT_HANDLER`](errors.md#dk_controlled_without_handler) and drops every
update to the slice. With an `onStateChange` that does not update what you pass in `state` (it
only logs, writes somewhere the component does not read, or the `if` around the setter never
matches), the update is dropped. In development the table reports
[`DK_CONTROLLED_NOT_FED_BACK`](errors.md#dk_controlled_not_fed_back) one second later, once the
value in `state` is still the old one; in production nothing is reported, and `explain()` shows a
normal pipeline. To confirm, log `updater({ sorting })` inside your `onStateChange` and check that
the value you pass back in `state` on the next render is that result.

**Fix:** feed the result back — or, to only set a starting value (restoring a saved view), use
`initialState` instead and let the table own the slice.

```tsx
import { type SortingState, useDataTable } from 'datakable/react'
import { useState } from 'react'

type User = { id: number; name: string; age: number }

export function Users({ users }: { users: User[] }) {
  const [sorting, setSorting] = useState<SortingState<User>>({ by: [] })
  const table = useDataTable({
    data: users,
    rowKey: 'id',
    state: { sorting },
    // The table asks; you decide. Feed the result back, or every sort is dropped.
    onStateChange: (updater) => {
      const next = updater({ sorting })
      if (next.sorting) setSorting(next.sorting)
    },
  })
  return (
    <>
      <button type="button" onClick={() => table.toggleSort('age')}>
        Sort by age
      </button>
      <ol>
        {table.rowModel.rows.map((row) => (
          <li key={row.key}>{row.original.name}</li>
        ))}
      </ol>
    </>
  )
}
```

## The feature is in server mode

A feature with `mode: 'server'` holds its state but does not touch the rows: the server sorts,
filters or searches. With a `fetcher`, the table calls it with the new `sort` / `filters` /
`query` on every change; without one, it is your job to fetch the new page and pass it as `data`.

**Fix:** pass a `fetcher` that sends the state to the server — or use the client mode (the
default) when all the rows are in the browser.

```ts
import { createTable, type FetchParams, type FetchResult, sorting, withFetcher } from 'datakable'

type User = { id: number; name: string; age: number }

async function fetchUsers({ sort, signal }: FetchParams): Promise<FetchResult<User>> {
  const order = (sort ?? []).map((s) => `${s.desc ? '-' : ''}${s.id}`).join(',')
  const res = await fetch(`/api/users?sort=${order}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as FetchResult<User> // { rows, rowCount }
}

export const table = createTable({
  rowKey: 'id',
  // The server sorts: the fetcher receives `sort` and runs again whenever it changes.
  features: [sorting({ mode: 'server' })],
  fetcher: withFetcher(fetchUsers),
})
```

## The feature is not installed

`datakable`'s `createTable` and `datakable/react`'s `useDataTable` and `<DataTable />` install the
default preset (`columnFilters()`, `validity()`, `search()`, `sorting()`, `pagination()`) **only
when you pass no `features`**. A `features` array replaces the preset, and `@datakable/core` /
`@datakable/react` install no features at all. The table's type has only the installed features'
methods, so TypeScript reports the missing one; `<DataTable />` renders no sort buttons without
`sorting()`, and none on a column with `sortable: false`.

```ts
import { columnFilters, createTable, sorting } from 'datakable'

type User = { id: number; name: string; city: string }
declare const users: User[]

// `features` replaces the default preset: this table sorts, and nothing else.
const sortOnly = createTable({ data: users, features: [sorting()] })
// @ts-expect-error setColumnFilter does not exist: columnFilters() is not installed
sortOnly.setColumnFilter('city', { type: 'equals', value: 'Paris' })

// List every feature you use (or pass no `features` for the whole preset).
const table = createTable({ data: users, features: [columnFilters(), sorting()] })
table.setColumnFilter('city', { type: 'equals', value: 'Paris' })
```

## Other causes

- **The filter value has the wrong type.** A `range` over numbers that arrive as strings, or a
  value read from an `<input>` without `Number(…)`: rows of the wrong type never match.
  [`DK_FILTER_TYPE_MISMATCH`](errors.md#dk_filter_type_mismatch) names the column and the fix.
- **A read-once option was changed.** `features`, `schema`, `invalidRows`, `initialState`, `name`,
  `timeout`, `strict` and `diagnostics` are read when the table is created. A new `features` array
  (say, switching a feature to server mode) is ignored —
  [`DK_OPTION_NO_EFFECT`](errors.md#dk_option_no_effect) from `setOptions()`. Create a new table
  instead; in React, change the component's `key`.
- **The page resets.** Sorting, filtering or searching moves back to page 1 (`autoResetPageIndex`,
  on by default in `pagination()`); that is by design, not a lost update.

## Related codes

[`DK_CONTROLLED_WITHOUT_HANDLER`](errors.md#dk_controlled_without_handler) ·
[`DK_CONTROLLED_NOT_FED_BACK`](errors.md#dk_controlled_not_fed_back) ·
[`DK_FILTER_TYPE_MISMATCH`](errors.md#dk_filter_type_mismatch) ·
[`DK_OPTION_NO_EFFECT`](errors.md#dk_option_no_effect) ·
[`DK_MODE_ORDER`](errors.md#dk_mode_order) ·
[`DK_FETCHER_WITHOUT_SERVER_MODE`](errors.md#dk_fetcher_without_server_mode)

## See also

- [The table shows no rows](no-rows.md)
- [Search finds nothing, or is slow](search-finds-nothing-or-is-slow.md)
- [`@datakable/core` server mode](../../packages/core/README.md#server-mode)
- Guides: [column filters](../how-to-use/column-filters.md), [sorting](../how-to-use/sorting.md),
  [controlled state](../how-to-use/state.md#controlled-state), [core
  concepts](../how-to-use/core-concepts.md).
- [Keep the table's state in the URL](../examples/url-state.md) — a controlled slice that is fed
  back correctly.
- [How to fix](README.md) — every symptom.
