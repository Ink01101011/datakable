import { describe, expectTypeOf, it } from 'vitest'
import {
  type ColumnFiltersState,
  createTable,
  type DefaultFeatures,
  defaultFeatures,
  type PaginationState,
  type SearchState,
  type SortingState,
  type StateOf,
  type ValidityState,
} from '../index'

type User = { name: string; age: number }
declare const users: User[]

describe('default preset types', () => {
  it('DefaultFeatures is the typeof defaultFeatures tuple', () => {
    expectTypeOf(defaultFeatures).toEqualTypeOf<DefaultFeatures>()
    expectTypeOf<DefaultFeatures['length']>().toEqualTypeOf<5>()
  })

  it('StateOf<DefaultFeatures, T> has the five slices', () => {
    type S = StateOf<DefaultFeatures, User>
    expectTypeOf<keyof S>().toEqualTypeOf<
      'columnFilters' | 'validity' | 'search' | 'sorting' | 'pagination'
    >()
    expectTypeOf<S['columnFilters']>().toEqualTypeOf<ColumnFiltersState<User>>()
    expectTypeOf<S['validity']>().toEqualTypeOf<ValidityState>()
    expectTypeOf<S['search']>().toEqualTypeOf<SearchState>()
    expectTypeOf<S['sorting']>().toEqualTypeOf<SortingState<User>>()
    expectTypeOf<S['pagination']>().toEqualTypeOf<PaginationState>()
  })

  it('core createTable with features: defaultFeatures is precise', () => {
    const t = createTable({ data: users, features: defaultFeatures })
    expectTypeOf(t.getState().sorting).toEqualTypeOf<SortingState<User>>()
    expectTypeOf(t.toggleSort).parameter(0).toEqualTypeOf<'name' | 'age'>()
    // @ts-expect-error not a column of User
    t.toggleSort('nope')
  })
})
