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
