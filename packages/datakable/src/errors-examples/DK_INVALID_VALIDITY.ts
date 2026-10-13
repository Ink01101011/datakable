import { createTable, type StandardSchemaV1, type ValidityState, validity } from '@datakable/core'
import { withSchema } from '@datakable/core/schema'

type User = { id: number; email: string }
// Any Standard Schema v1 (zod, valibot, arktype, …); a hand-written one here.
const UserSchema: StandardSchemaV1<unknown, User> = {
  '~standard': {
    version: 1,
    vendor: 'example',
    validate: (v) =>
      typeof (v as User).email === 'string'
        ? { value: v as User }
        : { issues: [{ message: 'email is required', path: ['email'] }] },
  },
}

const table = createTable({
  data: [{ id: 1, email: 'ada@example.com' }, { id: 2 }],
  schema: withSchema(UserSchema),
  invalidRows: 'flag',
  features: [validity()],
})

const option = 'Invalid' // e.g. a <select> label used as the value
table.setValidity(option as ValidityState) // ignored: the filter stays 'all'
