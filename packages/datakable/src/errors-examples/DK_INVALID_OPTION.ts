import { createTable } from '@datakable/core'

const users = [{ id: 1, name: 'Ada' }]
const timeout = Number('30s') // NaN, e.g. read from an env variable

createTable({ data: users, timeout })
