import { type ColumnDef, columnFilters, DataTable, pagination, search, sorting } from 'datakable'
import type { ReactNode } from 'react'

export type Trade = { id: number; symbol: string; side: 'buy' | 'sell'; qty: number; at: Date }

// Stable references: columns and features outside the component, `trades` kept as one array
// (not re-created with .map/.filter on every render, which would re-ingest 100k rows).
const columns: ColumnDef<Trade, ReactNode>[] = [
  { key: 'symbol', header: 'Symbol', search: 1 }, // only weighted columns are searched
  { key: 'side', header: 'Side' },
  { key: 'qty', header: 'Quantity' },
  { key: 'at', header: 'Time', format: (at) => at.toISOString().slice(11, 19) },
]
const features = [
  columnFilters(),
  // Search when typing pauses, not on every keystroke over 100k rows.
  search({ typing: { strategy: 'debounce', wait: 200 } }),
  sorting(),
  pagination({ pageSize: 50 }), // only the visible page becomes Row objects and DOM rows
]

export function TradesTable({ trades }: { trades: Trade[] }) {
  return <DataTable data={trades} rowKey="id" columns={columns} features={features} />
}
