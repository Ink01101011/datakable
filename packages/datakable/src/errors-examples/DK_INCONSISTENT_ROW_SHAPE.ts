import { createTable } from '@datakable/core'

// Zero-config columns (no `columns` option) from rows that do not all have the same keys.
const rows: Record<string, unknown>[] = [
  { id: 1, name: 'Ada', team: 'core' },
  { id: 2, name: 'Grace' },
  { id: 3, name: 'Linus', team: 'kernel', remote: true },
]

createTable({ data: rows })
