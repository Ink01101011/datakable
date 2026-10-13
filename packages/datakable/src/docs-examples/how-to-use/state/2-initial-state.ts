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
