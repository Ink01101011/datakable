import { createTable, DatakableConfigError, sorting } from 'datakable'

type User = { id: number; name: string }
declare const users: User[]

try {
  // Two features with the same name: a configuration mistake, thrown at creation.
  createTable({ data: users, features: [sorting(), sorting()] })
} catch (e) {
  if (!(e instanceof DatakableConfigError)) throw e
  console.error(e.code) // 'DK_FEATURE_DUPLICATE'
  console.error(e.where) // { kind: 'feature', name: 'sorting' }
  console.error(e.fix, e.docs)
}
