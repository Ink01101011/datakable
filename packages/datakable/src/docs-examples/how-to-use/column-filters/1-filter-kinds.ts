import { createTable } from '@datakable/core'
import { columnFilters } from '@datakable/core/column-filters'

type User = {
  id: number
  name: string
  city: string
  age: number
  active: boolean
  joined: Date
  tags: string[]
}
declare const users: User[]

const table = createTable({ data: users, rowKey: 'id', features: [columnFilters()] })

// Each call sets one column's filter; filters on different columns combine with AND.
table.setColumnFilter('active', { type: 'equals', value: true })
table.setColumnFilter('name', { type: 'contains', value: 'mal' }) // case-insensitive
table.setColumnFilter('city', { type: 'in', value: ['Bangkok', 'Chiang Mai'] })
table.setColumnFilter('age', { type: 'range', value: { min: 18, max: 65 } }) // inclusive
table.setColumnFilter('joined', { type: 'range', value: { min: new Date('2024-01-01') } })
table.setColumnFilter('tags', { type: 'equals', value: 'admin' }) // any element matches

console.log(table.getRowModel().filteredCount)
console.log(table.getState().columnFilters.age) // { type: 'range', value: { min: 18, max: 65 } }

table.setColumnFilter('city', undefined) // removes one filter
table.resetColumnFilters() // removes them all
