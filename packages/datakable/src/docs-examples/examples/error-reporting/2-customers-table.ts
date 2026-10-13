import { createTable } from 'datakable'
import { type ErrorTracker, reportDiagnostics } from './1-report-diagnostics' // './report-diagnostics'

type Customer = { id: number; name: string; email: string }

export function customersTable(customers: Customer[], tracker: ErrorTracker) {
  return createTable({
    name: 'CustomersTable', // names the table in every diagnostic
    data: customers,
    rowKey: 'id',
    columns: [{ key: 'name' }, { key: 'email', sensitive: true }], // never logged, at any level
    // 'safe' (the production default): paths, indices, counts, value types, hashed row keys.
    diagnostics: { redact: 'safe' },
    onDiagnostic: reportDiagnostics(tracker),
  })
}
