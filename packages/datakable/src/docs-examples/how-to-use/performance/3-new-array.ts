import { createTable } from 'datakable'

type Order = { id: string; total: number }
declare const initial: Order[]
declare const incoming: Order

const table = createTable({ data: initial, rowKey: 'id' })

// Pass a new array: the caches are per data reference, so the table sees the change.
table.setOptions({ data: [...table.getData(), incoming] })

// Not this: the same array mutated keeps the old caches (DK_DATA_MUTATED in development).
// initial.push(incoming); table.setOptions({ data: initial })
