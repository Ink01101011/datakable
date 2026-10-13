import { createTable, type Diagnostic } from 'datakable'

type User = { id: number; name: string; email: string }
declare const users: User[]
declare const Sentry: {
  captureMessage(message: string, context: { level: string; extra: object }): void
}

const table = createTable({
  name: 'UsersTable', // context.table in every diagnostic (default: table#1, table#2, …)
  data: users,
  rowKey: 'id',
  onDiagnostic: (d: Diagnostic) => {
    // Called once per code and `where` per data reference (repeats raise context.occurrences.count).
    if (d.level === 'info') return
    Sentry.captureMessage(`${d.code} at ${JSON.stringify(d.where)}`, {
      level: d.level === 'error' ? 'error' : 'warning',
      extra: d.toJSON(), // safe: no context.cause, bigint and cycles handled
    })
  },
})

// The last 100 diagnostics, oldest first.
for (const d of table.getDiagnostics()) {
  console.log(d.code, d.level, d.where, d.fix[0], d.docs)
}
