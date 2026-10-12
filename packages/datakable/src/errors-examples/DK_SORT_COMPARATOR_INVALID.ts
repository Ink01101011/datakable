import { createTable, sorting } from '@datakable/core'

const tasks = [
  { id: 1, title: 'Ship', priority: 'high' },
  { id: 2, title: 'Test', priority: 'low' },
  { id: 3, title: 'Plan', priority: 'medium' },
]
const rank: Record<string, number> = { high: 0, medium: 1 } // 'low' is missing

const table = createTable({
  data: tasks,
  columns: [
    { key: 'title' },
    // rank.low is undefined: undefined - 0 is NaN
    { key: 'priority', sortFn: (a, b) => (rank[a] as number) - (rank[b] as number) },
  ],
  features: [sorting()],
})
table.toggleSort('priority')
table.getRowModel()
