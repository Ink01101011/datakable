import { createTable, sorting } from '@datakable/core'

const table = createTable({ data: [{ id: 1, name: 'Ada' }], features: [sorting()] })
table.destroy() // e.g. a component unmounted

table.toggleSort('name') // e.g. a timer or a late event handler
