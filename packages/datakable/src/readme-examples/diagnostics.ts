import { createTable, type Diagnostic } from '@datakable/core'

type User = { id: number; name: string; ssn: string }
declare const users: User[]
declare const Sentry: { captureMessage(message: string, context: object): void }

const table = createTable({
  name: 'UsersTable', // shown in every diagnostic
  data: users,
  rowKey: 'id',
  columns: [{ key: 'name' }, { key: 'ssn', sensitive: true }],
  diagnostics: { redact: 'safe' }, // 'safe' (prod default) | 'keys' (dev default) | 'full' | fn
  onDiagnostic: (d: Diagnostic) => {
    // code, level, where, problem, impact, fix[], docs, context, fingerprint
    if (d.level === 'error') Sentry.captureMessage(d.code, d.toJSON())
  },
  strict: false, // true: error-level diagnostics throw DatakableError
})

for (const d of table.getDiagnostics()) console.log(d.code, d.where, d.fix)
