import { createTable, type StandardSchemaV1 } from '@datakable/core'
import { withSchema } from '@datakable/core/schema'

type User = { id: number; name: string; age: number }
// Any Standard Schema v1 (zod, valibot, arktype, …); a hand-written one here.
const UserSchema: StandardSchemaV1<unknown, User> = {
  '~standard': {
    version: 1,
    vendor: 'example',
    validate: (v) =>
      typeof (v as User).age === 'number'
        ? { value: v as User }
        : { issues: [{ message: 'Expected number', path: ['age'] }] },
  },
}

const json: unknown[] = [
  { id: 1, name: 'Ada', age: 36 },
  { id: 2, name: 'Grace', age: '45' }, // a string from the API
  { id: 3, name: 'Linus', age: 54 },
]

const table = createTable({
  data: json,
  schema: withSchema(UserSchema),
  columns: [{ key: 'name' }, { key: 'age' }],
})
table.getRowModel() // 2 rows: row #1 was dropped (invalidRows: 'drop', the default)
