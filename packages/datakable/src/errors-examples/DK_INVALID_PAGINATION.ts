import { createTable, pagination } from '@datakable/core'

const users = Array.from({ length: 100 }, (_, i) => ({ id: i }))
const table = createTable({ data: users, features: [pagination({ pageSize: 25 })] })

const selected = 'All' // e.g. a <select> option value
table.setPageSize(Number(selected)) // NaN: ignored, the page size stays 25
