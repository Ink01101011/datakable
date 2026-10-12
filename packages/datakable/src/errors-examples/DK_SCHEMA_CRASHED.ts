import { createTable, type StandardSchemaV1 } from '@datakable/core'

type User = { id: number; email: string }
// A custom check that throws instead of returning an issue.
const UserSchema: StandardSchemaV1<unknown, User> = {
  '~standard': {
    version: 1,
    vendor: 'example',
    validate: (v) => {
      const email = (v as { email?: string }).email
      if (!email?.includes('@')) throw new TypeError('bad email')
      return { value: v as User }
    },
  },
}

const table = createTable({
  data: [{ id: 1, email: 'ada@example.com' }, { id: 2 }],
  schema: UserSchema,
})
table.getRowModel()
