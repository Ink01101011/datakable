export * from '@datakable/react'
// The zero-config `createTable` (default preset) shadows the bare core one re-exported above.
export { createTable } from './create-table'
// Likewise for the component: `<DataTable data={rows} />` installs the default preset.
export { DataTable } from './data-table'
// Likewise for the React hook: `useDataTable({ data })` installs the default preset.
export { useDataTable } from './use-data-table'
