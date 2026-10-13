import { createTable } from 'datakable'

type Patient = { id: string; name: string; ssn: string; ward: string }
declare const patients: Patient[]

const table = createTable({
  data: patients,
  rowKey: 'id',
  columns: [
    { key: 'name', sensitive: true }, // never written to any diagnostic, at any level
    { key: 'ssn', sensitive: true },
    { key: 'ward' },
  ],
  diagnostics: {
    // A level ('safe' | 'keys' | 'full'), or a rule on top of the default level. Return a string
    // to log instead of the value, or undefined to keep the built-in policy for that field.
    // `path` names the field: 'where.key', 'details.value', 'details.keys.2', …
    redact: (_path, value) =>
      typeof value === 'string' && value.includes('@') ? '[email]' : undefined,
  },
})

console.log(table.getDiagnostics().map((d) => d.toJSON()))
