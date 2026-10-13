import { createTable } from '@datakable/core'
import { type StandardSchemaV1, withSchema } from '@datakable/core/schema'
import { sorting } from '@datakable/core/sorting'

type User = { id: number; name: string; joined: Date }
// Any Standard Schema v1: zod, valibot, arktype, … e.g.
// z.object({ id: z.number(), name: z.string(), joined: z.coerce.date() })
declare const UserSchema: StandardSchemaV1<unknown, User>
declare const json: unknown[] // e.g. await res.json(): not trusted yet

const table = createTable({
  data: json, // raw input: every row is validated
  schema: withSchema(UserSchema), // the row type is the schema's output: User
  rowKey: 'id',
  features: [sorting()],
})

table.toggleSort('joined') // typed against User
for (const row of table.getRowModel().rows) {
  console.log(row.original.joined.getFullYear()) // the output value (a Date, after coercion)
}
// invalidRows: 'drop' (the default) removed the failing rows; they are still listed here:
for (const { index, raw, issues } of table.getInvalidRows()) console.warn(index, raw, issues)
