import { createTable, DatakableConfigError } from 'datakable'

type User = { id: number; name: string }
declare const users: User[]

try {
  // A configuration mistake throws at creation (development builds check every option): here, a
  // timeout that is not > 0.
  createTable({ data: users, timeout: -1 })
} catch (e) {
  if (e instanceof DatakableConfigError) {
    console.error(e.code, e.where, e.fix) // 'DK_INVALID_OPTION', { kind: 'option', … }, [ … ]
  }
}
