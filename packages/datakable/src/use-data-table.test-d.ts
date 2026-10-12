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
import { useDataTable } from './index'

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
})
