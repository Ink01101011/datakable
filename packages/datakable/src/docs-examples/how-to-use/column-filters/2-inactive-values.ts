import { createTable } from '@datakable/core'
import { columnFilters } from '@datakable/core/column-filters'

type User = { id: number; name: string; age: number }
declare const users: User[]
declare const input: { name: string; minAge: string }

const table = createTable({ data: users, rowKey: 'id', features: [columnFilters()] })

// Bind inputs directly: an empty value leaves the filter in the state but inactive.
table.setColumnFilter('name', { type: 'contains', value: input.name }) // '' → inactive
table.setColumnFilter('age', {
  type: 'range',
  // Convert before filtering: a string bound would match nothing (DK_FILTER_TYPE_MISMATCH).
  value: { min: input.minAge === '' ? undefined : Number(input.minAge) }, // no bound → inactive
})
