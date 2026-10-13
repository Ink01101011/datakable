import { createTable } from 'datakable'

type User = { id: number; name: string }
declare const firstLoad: User[]
declare const reloaded: User[]

const table = createTable({ name: 'UsersTable', data: firstLoad, rowKey: 'id' })

// New data: pass a new array. The table ingests it, keeps its state (sort, filters, search) and
// notifies subscribers once.
table.setOptions({ data: reloaded })

// Read-once options keep the value they were created with; development builds report the
// attempt as DK_OPTION_NO_EFFECT.
table.setOptions({ name: 'Renamed' })
console.log(table.getOptions().name) // 'UsersTable'
