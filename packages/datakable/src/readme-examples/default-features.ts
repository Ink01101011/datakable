import { createTable, defaultFeatures } from '@datakable/core'

type User = { id: number; name: string }
declare const users: User[]

// `@datakable/core`'s createTable installs nothing by default. Opt into the preset explicitly:
// [columnFilters(), validity(), search(), sorting(), pagination()]
const table = createTable({ data: users, features: defaultFeatures })
table.toggleSort('name')
