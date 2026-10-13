# A custom feature: row selection

Features are how DataKable grows: the built-ins (sorting, search, …) use the same `defineFeature`
contract you can use. This recipe adds row selection as a feature, so its state lives in the
table's state and its methods are on the table, typed.

## Goal

Add checkboxes to select rows, a "Select page" and a "Clear" button, and a selected count, with
`table.toggleRowSelected(key)` and `table.state.rowSelection` typed like any built-in.

## The code

The feature:

```ts
import { defineFeature, type RowKey } from 'datakable'

export type RowSelectionState = { selected: readonly RowKey[] }

// A feature that takes no part in the row model (`stage: 'none'`): it adds a state slice
// (`state.rowSelection`) and methods on the table. No type arguments: both are inferred.
export const rowSelection = () =>
  defineFeature({
    name: 'rowSelection',
    stage: 'none',
    initialState: (): RowSelectionState => ({ selected: [] }),
    createApi: (ctx) => ({
      isRowSelected: (key: RowKey) => ctx.getState().selected.includes(key),
      toggleRowSelected(key: RowKey) {
        ctx.setState(({ selected }) => ({
          selected: selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key],
        }))
      },
      selectRows: (keys: readonly RowKey[]) => ctx.setState({ selected: [...keys] }),
      clearSelection: () => ctx.setState({ selected: [] }),
    }),
  })
```

Using it next to built-in features:

```tsx
import { pagination, search, sorting, useDataTable } from 'datakable'
import { rowSelection } from './1-row-selection' // './row-selection' in your app

export type User = { id: number; name: string }

// Passing `features` replaces the default preset: list the built-ins you want next to yours.
const features = [search(), sorting(), pagination({ pageSize: 20 }), rowSelection()] as const

export function UsersTable({ users }: { users: User[] }) {
  const table = useDataTable({ data: users, rowKey: 'id', features })
  const { selected } = table.state.rowSelection // typed: RowSelectionState
  const pageKeys = table.rowModel.rows.map((row) => row.key)

  return (
    <section>
      <p>
        {selected.length} selected{' '}
        <button type="button" onClick={() => table.selectRows(pageKeys)}>
          Select page
        </button>{' '}
        <button type="button" onClick={table.clearSelection}>
          Clear
        </button>
      </p>
      <ul>
        {table.rowModel.rows.map((row) => (
          <li key={row.key}>
            <label>
              <input
                type="checkbox"
                checked={table.isRowSelected(row.key)}
                onChange={() => table.toggleRowSelected(row.key)}
              />
              {row.original.name}
            </label>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

## What you will see

- "0 selected" at first. Ticking a box selects that row; "Select page" selects the 20 rows on the
  page; unticking one leaves 19; Clear empties the selection.
- The selection is kept by row key, so it survives sorting, searching and paging.
- `table.state.rowSelection` is typed `RowSelectionState`, and the four methods are on the table's
  type. Without `rowSelection()` in `features`, `table.toggleRowSelected` does not compile.
- State changes go through the table like any other: `subscribe` listeners are notified, and
  controlled state works (`state: { rowSelection }` with `onStateChange`).

## Variations

- **A row model step:** a feature with `stage: 'filter' | 'search' | 'sort' | 'paginate'` and a
  `rowModel(indices, state, ctx)` function takes part in the pipeline; it returns the kept row
  indices, in order, without mutating its input.
- **Row-typed state:** to type the state or API with the row type (as `sorting()` does with column
  paths), declare a `FeatureTypes` interface and pass it as a type argument:
  `defineFeature<'rowSelection', SelectionTypes>(…)`.
- **Name clashes:** a method name another feature or the table already has is reported as
  `DK_FEATURE_API_CONFLICT`; two features with the same `name` as `DK_FEATURE_DUPLICATE`.
- **Interceptors:** a feature can bring `interceptors` (for example to clear the selection when the
  data changes): see [A logging interceptor](logging-interceptor.md) for the shape.

## See also

- [Features](../../packages/core/README.md#features) in `@datakable/core` — the built-ins and
  the feature contract.
- [How to fix](../how-to-fix/README.md) — `DK_FEATURE_*` diagnostics.
- [Examples](README.md)
