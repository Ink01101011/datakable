import type { ColumnDef } from 'datakable'
import type { ReactNode } from 'react'

type Order = { id: number; placed: Date }

// The default formatter uses toLocaleString(): the server's locale and time zone, then the
// browser's. Fix both, so the server HTML and the hydrated text are the same.
const dateTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

export const columns: ColumnDef<Order, ReactNode>[] = [
  { key: 'id' },
  { key: 'placed', format: (placed) => dateTime.format(placed) },
]
