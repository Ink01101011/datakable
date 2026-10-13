// `npm install @datakable/core`: the headless core, one entry per feature. Only what you import
// is bundled — here the table, sorting and pagination; no search engine, no filters.
import { createTable } from '@datakable/core'
import { pagination } from '@datakable/core/pagination'
import { sorting } from '@datakable/core/sorting'

type User = { id: number; name: string; age: number }
declare const users: User[]

export const table = createTable({
  data: users,
  rowKey: 'id',
  features: [sorting(), pagination({ pageSize: 25 })],
})
