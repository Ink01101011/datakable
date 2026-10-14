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
