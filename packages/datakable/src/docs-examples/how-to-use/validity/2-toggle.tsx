import {
  type StandardSchemaV1,
  useDataTable,
  type ValidityState,
  withSchema,
} from 'datakable/react'

type User = { id: number; name: string; email: string }
declare const UserSchema: StandardSchemaV1<unknown, User>

const schema = withSchema(UserSchema)

export function Users({ json }: { json: unknown[] }) {
  // The default preset includes validity().
  const table = useDataTable({ data: json, schema, invalidRows: 'flag', rowKey: 'id' })
  return (
    <>
      <select
        value={table.state.validity}
        onChange={(e) => table.setValidity(e.target.value as ValidityState)}
      >
        <option value="all">All rows</option>
        <option value="valid">Valid only</option>
        <option value="invalid">Invalid only ({table.getInvalidRows().length})</option>
      </select>
      <ul>
        {table.rowModel.rows.map((row) =>
          row.valid ? (
            <li key={row.key}>{row.original.name}</li>
          ) : (
            <li key={row.key} aria-invalid="true">
              Row {row.index}: {row.issues.map((i) => i.message).join('; ')}
            </li>
          ),
        )}
      </ul>
    </>
  )
}
