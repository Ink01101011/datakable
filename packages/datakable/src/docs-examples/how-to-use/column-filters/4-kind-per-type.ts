import { createTable } from '@datakable/core'
import { columnFilters } from '@datakable/core/column-filters'

type User = { id: number; name: string; active: boolean; manager: { name: string } | null }
declare const users: User[]

const table = createTable({ data: users, rowKey: 'id', features: [columnFilters()] })

table.setColumnFilter('manager.name', { type: 'contains', value: 'ann' }) // dot-paths work
// @ts-expect-error 'range' needs a number, bigint or Date column; name is a string
table.setColumnFilter('name', { type: 'range', value: { min: 'a' } })
// @ts-expect-error a boolean column takes 'equals' only
table.setColumnFilter('active', { type: 'in', value: [true] })
// @ts-expect-error 'nmae' is not a path of User
table.setColumnFilter('nmae', { type: 'equals', value: 'x' })
