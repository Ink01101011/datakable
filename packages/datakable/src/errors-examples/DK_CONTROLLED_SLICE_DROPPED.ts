import {
  createTable,
  type PaginationState,
  pagination,
  type SortingState,
  sorting,
} from '@datakable/core'

type User = { id: number; name: string }
const users: User[] = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Grace' },
]

let mine: { sorting: SortingState<User>; pagination: PaginationState } = {
  sorting: { by: [] },
  pagination: { pageIndex: 0, pageSize: 10 },
}
const table = createTable({
  data: users,
  features: [sorting(), pagination()],
  state: mine,
  onStateChange: (updater) => {
    mine = { ...mine, ...updater(mine) }
    table.setOptions({ state: { sorting: mine.sorting } }) // pagination is left out
  },
})
table.toggleSort('name')
