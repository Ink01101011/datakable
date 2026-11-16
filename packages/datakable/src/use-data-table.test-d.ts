import {
  type ColumnFiltersState,
  type PaginationState,
  type SearchOptions,
  type SearchOutcome,
  type SearchState,
  type SortingState,
  search,
  sorting,
  type ValidityState,
} from '@datakable/core'
import { describe, expectTypeOf, it } from 'vitest'
import { useDataTable } from './react'

type User = { id: number; name: string; address: { city: string } }
declare const users: User[]

describe("datakable's useDataTable types", () => {
  it('the preset types state and API with no type arguments', () => {
    const t = useDataTable({ data: users })
    expectTypeOf(t.state.columnFilters).toEqualTypeOf<ColumnFiltersState<User>>()
    expectTypeOf(t.state.validity).toEqualTypeOf<ValidityState>()
    expectTypeOf(t.state.search).toEqualTypeOf<SearchState>()
    expectTypeOf(t.state.sorting).toEqualTypeOf<SortingState<User>>()
    expectTypeOf(t.state.pagination).toEqualTypeOf<PaginationState>()
    expectTypeOf(t.setSearch).returns.toEqualTypeOf<Promise<SearchOutcome>>()
    // @ts-expect-error not a path of User
    t.toggleSort('nope')
  })

  it('features replaces the preset in the types too', () => {
    const t = useDataTable({ data: users, features: [sorting()] })
    expectTypeOf(t.state).toEqualTypeOf<{ sorting: SortingState<User> }>()
    // @ts-expect-error search is not installed
    void t.setSearch
  })

  it('search({ fuzzyMaxRows }) passes through datakable and useDataTable (#123)', () => {
    expectTypeOf<SearchOptions['fuzzyMaxRows']>().toEqualTypeOf<number | undefined>()
    const t = useDataTable({ data: users, features: [search({ fuzzyMaxRows: 50_000 })] })
    expectTypeOf(t.state).toEqualTypeOf<{ search: SearchState }>()
    // @ts-expect-error a row count
    search({ fuzzyMaxRows: '50000' })
  })
})
