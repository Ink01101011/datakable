import { createTable } from '@datakable/core'
import { type StandardSchemaV1, withSchema } from '@datakable/core/schema'
import { validity } from '@datakable/core/validity'

type User = { id: number; name: string; email: string }
declare const UserSchema: StandardSchemaV1<unknown, User>
declare const json: unknown[]

const table = createTable({
  data: json,
  schema: withSchema(UserSchema),
  invalidRows: 'flag', // keep the failing rows, marked invalid
  columns: [{ key: 'name' }, { key: 'email' }],
  features: [validity()],
})

for (const row of table.getRowModel().rows) {
  if (row.valid) {
    console.log(row.original.email) // narrowed: original is a User
  } else {
    // original is the raw, unvalidated value (unknown)
    console.warn(row.issues) // every issue of the row
    console.warn(row.getCellIssues('email')) // the issues whose path touches `email`
  }
}

table.setValidity('invalid') // only the flagged rows, e.g. for a "needs fixing" view
