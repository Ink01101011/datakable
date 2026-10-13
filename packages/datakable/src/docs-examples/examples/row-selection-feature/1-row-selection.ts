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
