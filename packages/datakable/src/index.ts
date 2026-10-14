// `datakable` is framework-free (#63): core plus the zero-config `createTable` (default preset).
// No module reachable from here imports React; `<DataTable />` and `useDataTable` are on
// `datakable/react`.
// The zero-config `createTable` (default preset) shadows the bare core one re-exported below.

export * from '@datakable/core'
export { createTable } from './create-table'
