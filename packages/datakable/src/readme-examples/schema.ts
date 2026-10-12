import { createTable, type StandardSchemaV1 } from '@datakable/core'
import { withSchema } from '@datakable/core/schema'
import { validity } from '@datakable/core/validity'

type User = { id: number; name: string }
// Any Standard Schema v1: zod, valibot, arktype, …  e.g. z.object({ id: z.number(), … })
declare const UserSchema: StandardSchemaV1<unknown, User>
declare const json: unknown[] // e.g. await res.json()

const table = createTable({
  data: json, // raw input: every row is validated
  schema: withSchema(UserSchema), // opt-in validation; the row type is the schema's output
  invalidRows: 'flag', // 'drop' (default) | 'flag' | 'throw'
  rowKey: 'id',
  features: [validity()], // filters 'all' | 'valid' | 'invalid'
})

for (const row of table.getRowModel().rows) {
  if (row.valid) {
    console.log(row.original.name) // narrowed: original is a User
  } else {
    console.warn(row.issues, row.getCellIssues('name')) // original is unknown
  }
}
table.setValidity('invalid') // only the flagged rows
console.log(table.getInvalidRows()) // [{ index, raw, issues }] in every mode
