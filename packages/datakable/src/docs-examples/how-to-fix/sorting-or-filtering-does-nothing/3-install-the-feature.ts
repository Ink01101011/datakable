import { columnFilters, createTable, sorting } from 'datakable'

type User = { id: number; name: string; city: string }
declare const users: User[]

// `features` replaces the default preset: this table sorts, and nothing else.
const sortOnly = createTable({ data: users, features: [sorting()] })
// @ts-expect-error setColumnFilter does not exist: columnFilters() is not installed
sortOnly.setColumnFilter('city', { type: 'equals', value: 'Paris' })

// List every feature you use (or pass no `features` for the whole preset).
const table = createTable({ data: users, features: [columnFilters(), sorting()] })
table.setColumnFilter('city', { type: 'equals', value: 'Paris' })
