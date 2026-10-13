import { createTable, pagination, search, sorting } from 'datakable'

const users = [
  { id: 1, name: 'Ada', city: 'London' },
  { id: 2, name: 'Grace', city: 'New York' },
  { id: 3, name: 'Linus', city: 'Helsinki' },
]

export const table = createTable({
  data: users,
  rowKey: 'id',
  // The query applies 300 ms after the last keystroke (the default with mode: 'server').
  features: [search({ typing: { strategy: 'debounce', wait: 300 } }), sorting(), pagination()],
})

void table.setSearch('ada')
const { input, query, status } = table.getState().search
console.log(input, JSON.stringify(query), status, table.getRowModel().rows.length)

// Await setSearch() or flushSearch() (e.g. on Enter) before reading the searched rows.
await table.flushSearch()
console.log(table.getState().search.query, table.getRowModel().rows.length)
