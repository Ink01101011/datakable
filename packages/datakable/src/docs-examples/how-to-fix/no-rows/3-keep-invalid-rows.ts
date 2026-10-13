import { createTable, type StandardSchemaV1, withSchema } from 'datakable'

type User = { id: number; name: string }
declare const UserSchema: StandardSchemaV1<unknown, User> // zod, valibot, arktype, …
declare const json: unknown[]

const table = createTable({
  data: json,
  rowKey: 'id',
  schema: withSchema(UserSchema),
  // Keep the rows that fail the schema (row.valid === false) instead of dropping them.
  invalidRows: 'flag',
})

// Every invalid row, in every mode: its index in `data`, the raw value and the issues.
for (const { index, issues } of table.getInvalidRows()) console.warn(index, issues)
