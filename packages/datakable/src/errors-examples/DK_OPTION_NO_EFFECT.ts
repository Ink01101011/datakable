import { createTable } from '@datakable/core'

const users = [{ id: 1, name: 'Ada' }]

// `flag` keeps rows that fail options.schema, and no schema is set.
createTable({ data: users, invalidRows: 'flag' })
