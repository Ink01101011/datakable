import { pagination, search, sorting } from '@datakable/core'
import { describe, expectTypeOf, it } from 'vitest'
import { makeSchema, userCheck } from '../../core/src/ingest/test-schemas'
import { DataTable, type DataTableProps } from './data-table'
import { useDataTable } from './use-data-table'

type User = { id: number; name: string; age: number }
declare const users: User[]

describe('<DataTable /> props (§10)', () => {
  it('accepts a useDataTable result as table', () => {
    function A() {
      const t = useDataTable({ data: users, features: [sorting(), search(), pagination()] })
      return <DataTable table={t} caption="Users" />
    }
    expectTypeOf(A).toBeFunction()
  })

  it('zero-config: the options are props; columns are typed against data', () => {
    ;<DataTable data={users} columns={[{ key: 'name', cell: ({ value }) => <b>{value}</b> }]} />
    // @ts-expect-error: not a key of User
    ;<DataTable data={users} columns={[{ key: 'nope' }]} />
    ;<DataTable data={[] as unknown[]} schema={makeSchema(userCheck)} invalidRows="flag" />
  })

  it('table and data are exclusive', () => {
    function B() {
      const t = useDataTable({ data: users })
      // @ts-expect-error: data with table
      return <DataTable table={t} data={users} />
    }
    expectTypeOf<DataTableProps>().toHaveProperty('components')
    void B
  })
})
