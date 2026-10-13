import { createTable } from 'datakable'

const readings = Array.from({ length: 100_000 }, (_, i) => ({
  id: i,
  sensor: `sensor-${i % 8}`,
  value: (i * 7919) % 1000,
}))

// The pipeline works on row indices; Row objects are created for the visible page only. With
// pagination() (in the default preset) that is one page of rows, whatever the data size.
export const table = createTable({ data: readings, rowKey: 'id' })
table.setPageSize(50)
console.log(table.getRowModel().rows.length, table.getRowModel().filteredCount)
