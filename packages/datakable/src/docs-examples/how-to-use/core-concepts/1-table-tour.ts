import { createTable } from 'datakable'

type User = { id: number; name: string; address: { city: string } }

const users: User[] = [
  { id: 7, name: 'Mali', address: { city: 'Bangkok' } },
  { id: 9, name: 'Anan', address: { city: 'Chiang Mai' } },
]

const table = createTable({
  data: users,
  rowKey: 'id',
  columns: [{ key: 'name' }, { key: 'address.city' }],
})

const model = table.getRowModel()
// The same object until data, state or columns change the result.
console.log(model === table.getRowModel()) // true
console.log(model.filteredCount, model.totalCount, model.status, model.isInitialLoad) // 2 2 'idle' false

for (const row of model.rows) {
  // key: the rowKey value · index: position in the data · original: the row object as passed
  console.log(row.key, row.index, row.original.name, row.getValue('address.city'))
}
