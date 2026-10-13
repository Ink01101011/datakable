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
