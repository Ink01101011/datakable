import { type ColumnDef, type StandardSchemaV1, useDataTable, withSchema } from 'datakable'
import type { ReactNode } from 'react'

type User = { id: number; name: string; email: string }
declare const UserSchema: StandardSchemaV1<unknown, User>

const columns: ColumnDef<User, ReactNode>[] = [
  { key: 'name', header: 'Name' },
  {
    key: 'email',
    header: 'Email',
    cell: ({ value }) => <a href={`mailto:${value}`}>{value}</a>, // valid rows: value is a string
    // Flagged rows whose issues touch this cell: the raw value, typed unknown.
    invalidCell: ({ value, issues }) => (
      <span title={issues.map((i) => i.message).join('; ')}>{String(value ?? '')} ⚠</span>
    ),
  },
]

export function Users({ json }: { json: unknown[] }) {
  const table = useDataTable({
    data: json,
    schema: withSchema(UserSchema),
    invalidRows: 'flag',
    rowKey: 'id',
    columns,
  })
  return <p>{table.getInvalidRows().length} rows need fixing</p>
}
