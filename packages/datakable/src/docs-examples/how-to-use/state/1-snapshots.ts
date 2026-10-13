import { createTable } from 'datakable'

type User = { id: number; name: string; age: number }
declare const users: User[]

const table = createTable({ data: users, rowKey: 'id' })

const before = table.getState()
// One slice per installed feature: columnFilters, validity, search, sorting, pagination.
console.log(before.sorting.by, before.pagination) // [] { pageIndex: 0, pageSize: 10 }

// Listeners get the new snapshot and the previous one.
const unsubscribe = table.subscribe((state, prev) => {
  if (state.sorting !== prev.sorting) console.log('sort changed', state.sorting.by)
})

// A feature method is one update: one notification.
table.toggleSort('age')

// setState merges slices: a partial object, or a function of the current state.
table.setState({ pagination: { pageIndex: 0, pageSize: 50 } })
table.setState((s) => ({ pagination: { ...s.pagination, pageIndex: 1 } }))

console.log(before === table.getState()) // false: a new snapshot; `before` is unchanged
unsubscribe()
