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
