import {
  type ColumnFiltersState,
  type PaginationState,
  type SearchOutcome,
  type SearchState,
  type SortingState,
  sorting,
  type ValidityState,
} from '@datakable/core'
import { describe, expectTypeOf, it } from 'vitest'
import { createTable } from './index'

type User = { id: number; name: string; address: { city: string } }
declare const users: User[]

describe('zero-config createTable types', () => {
  it('getState slices and API methods are typed with no type arguments', () => {
    const t = createTable({ data: users })
    const s = t.getState()
    expectTypeOf(s.columnFilters).toEqualTypeOf<ColumnFiltersState<User>>()
    expectTypeOf(s.validity).toEqualTypeOf<ValidityState>()
    expectTypeOf(s.search).toEqualTypeOf<SearchState>()
    expectTypeOf(s.sorting).toEqualTypeOf<SortingState<User>>()
    expectTypeOf(s.pagination).toEqualTypeOf<PaginationState>()
    expectTypeOf(t.toggleSort)
      .parameter(0)
      .toEqualTypeOf<'id' | 'name' | 'address' | 'address.city'>()
    expectTypeOf(t.setSearch).returns.toEqualTypeOf<Promise<SearchOutcome>>()
    expectTypeOf(t.getPageCount()).toEqualTypeOf<number>()
    expectTypeOf(t.setValidity).parameter(0).toEqualTypeOf<ValidityState>()
    t.setColumnFilter('address.city', { type: 'contains', value: 'bang' })
    // @ts-expect-error not a path of User
    t.toggleSort('nope')
    // @ts-expect-error range needs a number / bigint / Date column
    t.setColumnFilter('name', { type: 'range', value: { min: 1 } })
    // @ts-expect-error not a slice of the preset
    void s.selection
  })

  it('an explicit row type keeps the preset: createTable<User>({ data })', () => {
    const t = createTable<User>({ data: users })
    expectTypeOf(t.getState().sorting).toEqualTypeOf<SortingState<User>>()
    // @ts-expect-error not a path of User
    t.toggleSort('nope')
  })

  it('features replaces the preset in the types too', () => {
    const t = createTable({ data: users, features: [sorting()] })
    expectTypeOf(t.getState()).toEqualTypeOf<{ sorting: SortingState<User> }>()
    // @ts-expect-error search is not installed
    void t.setSearch
  })
})
