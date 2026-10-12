import type { RowModel, SortingState } from '@datakable/core'
import { sorting } from '@datakable/core'
import { createElement } from 'react'
import { describe, expectTypeOf, test } from 'vitest'
import { type UseDataTableResult, useDataTable } from './use-data-table'

test('infers T from data', () => {
  type User = { id: number; name: string }
  const data: User[] = []
  expectTypeOf(useDataTable({ data })).toEqualTypeOf<UseDataTableResult<User>>()
})

describe('useDataTable forwarding types (§10)', () => {
  type User = { id: number; name: string; address: { city: string } }
  const data: User[] = []

  test('features type the state, the API and the row model', () => {
    const t = useDataTable({ data, features: [sorting()] })
    expectTypeOf(t.state).toEqualTypeOf<{ sorting: SortingState<User> }>()
    expectTypeOf(t.rowModel).toEqualTypeOf<RowModel<User>>()
    expectTypeOf(t.toggleSort)
      .parameter(0)
      .toEqualTypeOf<'id' | 'name' | 'address' | 'address.city'>()
    // @ts-expect-error not a path of User
    t.toggleSort('nope')
    // @ts-expect-error not installed
    void t.setSearch
  })

  test('cell renders a ReactNode (R = ReactNode)', () => {
    useDataTable({
      data,
      columns: [{ key: 'name', cell: ({ value }) => createElement('b', null, value) }],
    })
  })

  test('an explicit row type: useDataTable<User>({ data })', () => {
    const t = useDataTable<User>({ data })
    expectTypeOf(t.rowModel.rows[0]?.original).toEqualTypeOf<User | undefined>()
  })
})
