import { createTable, type StandardSchemaV1 } from '@datakable/core'
import { withSchema } from '@datakable/core/schema'
import { validity } from '@datakable/core/validity'

type User = { id: number; name: string }
// Any Standard Schema v1: zod, valibot, arktype, …
declare const UserSchema: StandardSchemaV1<unknown, User>
declare const json: unknown[]

const table = createTable({
  data: json,
  schema: withSchema(UserSchema),
  invalidRows: 'flag', // keep invalid rows, flagged: validity() filters on that flag
  rowKey: 'id',
  features: [validity()],
})

table.setValidity('invalid') // only the rows that failed the schema
console.log(table.getRowModel().filteredCount, table.getInvalidRows().length)
table.setValidity('valid') // only the rows that passed
table.setValidity('all') // every row (the default)
