import { createTable } from 'datakable'

type User = { id: number; name: string }
declare const users: User[]

// @ts-expect-error `rows` is not an option: the table has no data (DK_UNKNOWN_OPTION)
createTable({ rows: users })

createTable({ data: users }) // the rows go in `data`
