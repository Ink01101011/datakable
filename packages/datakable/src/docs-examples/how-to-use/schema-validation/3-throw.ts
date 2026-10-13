import { createTable } from '@datakable/core'
import { DatakableSchemaError, type StandardSchemaV1, withSchema } from '@datakable/core/schema'

type User = { id: number; name: string }
declare const UserSchema: StandardSchemaV1<unknown, User>
declare const json: unknown[]

// 'throw': invalid data is an error the caller must handle (e.g. a strict import screen).
try {
  const table = createTable({ data: json, schema: withSchema(UserSchema), invalidRows: 'throw' })
  console.log(table.getRowModel().totalCount)
} catch (e) {
  if (!(e instanceof DatakableSchemaError)) throw e
  // The same list getInvalidRows() would return: { index, raw, issues }.
  console.error(e.code, e.invalidRows.length)
}
