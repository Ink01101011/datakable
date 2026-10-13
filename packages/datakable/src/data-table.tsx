import type { InvalidRowsMode, TableSchema } from '@datakable/core'
import {
  DataTable as BareDataTable,
  type DataTableOwnProps,
  type DataTableProps,
  type DataTableSource,
} from '@datakable/react'
import type { ReactNode } from 'react'
import { useDataTable } from './use-data-table'

/**
 * `<DataTable />` with the default preset (§3.3, §10): `<DataTable data={rows} />` alone sorts,
 * searches and paginates. `<DataTable table={useDataTable(...)} />` renders that table as is.
 * Same props as `@datakable/react`'s `DataTable`.
 */
export function DataTable<
  T,
  const Sch extends TableSchema | undefined = undefined,
  const M extends InvalidRowsMode = 'drop',
>(props: DataTableProps<T, Sch, M>): ReactNode
export function DataTable(
  props: DataTableOwnProps & { table?: DataTableSource | undefined },
): ReactNode {
  if (props.table !== undefined) {
    return (
      <BareDataTable table={props.table} components={props.components} caption={props.caption} />
    )
  }
  return <Preset {...(props as DataTableOwnProps & { table?: undefined })} />
}

function Preset(props: DataTableOwnProps & { table?: undefined }) {
  const { components, caption, table: _, ...options } = props
  const table = useDataTable(options as never) as unknown as DataTableSource
  return <BareDataTable table={table} components={components} caption={caption} />
}
