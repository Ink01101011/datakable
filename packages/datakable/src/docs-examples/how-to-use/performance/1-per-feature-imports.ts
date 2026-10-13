// Only what is imported is bundled: the bare table, and the two features this table uses.
import { createTable } from '@datakable/core'
import { pagination } from '@datakable/core/pagination'
import { sorting } from '@datakable/core/sorting'

type Order = { id: string; total: number; placedAt: Date }
declare const orders: Order[]

const table = createTable({
  data: orders,
  rowKey: 'id',
  features: [sorting(), pagination({ pageSize: 50 })],
})
table.toggleSort('placedAt')
