import { createTable, DatakableError } from 'datakable'

type User = { id: number; name: string }
declare const fixture: User[]

// In a test: make every error-level diagnostic throw, so a broken fixture fails loudly.
try {
  const table = createTable({ data: fixture, rowKey: 'id', strict: true })
  table.getRowModel()
} catch (e) {
  if (e instanceof DatakableError) console.error(e.code, e.diagnostic.context.run)
  throw e
}
