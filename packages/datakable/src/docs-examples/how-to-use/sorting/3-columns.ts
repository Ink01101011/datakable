import { createTable } from '@datakable/core'
import { sorting } from '@datakable/core/sorting'

type Task = {
  id: number
  title: string
  priority: 'low' | 'medium' | 'high'
  owner: { name: string; team: string }
  created: Date
}
declare const tasks: Task[]

const RANK = { low: 0, medium: 1, high: 2 }

const table = createTable({
  data: tasks,
  rowKey: 'id',
  features: [sorting()],
  columns: [
    { key: 'title' },
    // sortFn compares two values of the column (typed as the column's value).
    { key: 'priority', sortFn: (a, b) => RANK[a] - RANK[b] },
    // An object column has no default order: `sortable: true` needs sortBy (or sortFn).
    { key: 'owner', format: (o) => o.name, sortable: true, sortBy: (task) => task.owner.team },
    // Force an algorithm for this column (here: its timestamps are mostly in order already).
    { key: 'created', sortAlgorithm: 'tim' },
  ],
})

table.toggleSort('priority')
