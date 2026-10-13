import { describe, expectTypeOf, it } from 'vitest'
import {
  type ColumnFilter,
  type ColumnFiltersState,
  columnFilters,
  createTable,
  type FilterFor,
} from '../../index'

type User = {
  id: number
  name: string
  nick: string | null
  age: number | null
  balance: bigint
  active: boolean
  joined: Date
  tags: string[]
  scores: number[]
  address: { city: string; geo: { lat: number } }
  meta: { raw: unknown }
}
declare const users: User[]

describe('columnFilters types', () => {
  it('state and API are typed per column through FilterFor (+ custom)', () => {
    const t = createTable({ data: users, features: [columnFilters()] })
    expectTypeOf(t.getState().columnFilters).toEqualTypeOf<ColumnFiltersState<User>>()

    t.setColumnFilter('name', { type: 'contains', value: 'ada' })
    t.setColumnFilter('name', { type: 'equals', value: 'Ada' })
    t.setColumnFilter('name', { type: 'in', value: ['Ada', 'Bob'] })
    t.setColumnFilter('nick', { type: 'contains', value: '' })
    t.setColumnFilter('age', { type: 'range', value: { min: 18 } })
    t.setColumnFilter('age', { type: 'in', value: [1, 2] })
    t.setColumnFilter('balance', { type: 'range', value: { max: 10n } })
    t.setColumnFilter('joined', { type: 'range', value: { min: new Date(0) } })
    t.setColumnFilter('active', { type: 'equals', value: true })
    t.setColumnFilter('address.geo.lat', { type: 'range', value: { min: 0, max: 90 } })
    t.setColumnFilter('tags', { type: 'contains', value: 'vip' })
    t.setColumnFilter('scores', { type: 'range', value: { min: 50 } })
    t.setColumnFilter('meta.raw', { type: 'equals', value: 'x' })
    t.setColumnFilter('address', {
      type: 'custom',
      value: 'Bangkok',
      fn: (a, city, row) => {
        expectTypeOf(a).toEqualTypeOf<{ city: string; geo: { lat: number } }>()
        expectTypeOf(row).toEqualTypeOf<User>()
        return a.city === city
      },
    })
    t.setColumnFilter('age', undefined)
    t.resetColumnFilters()

    // @ts-expect-error range is not a string filter
    t.setColumnFilter('name', { type: 'range', value: { min: 'a' } })
    // @ts-expect-error contains is not a number filter
    t.setColumnFilter('age', { type: 'contains', value: '1' })
    // @ts-expect-error boolean columns only allow equals
    t.setColumnFilter('active', { type: 'in', value: [true] })
    // @ts-expect-error equals value has the column's type
    t.setColumnFilter('age', { type: 'equals', value: '42' })
    // @ts-expect-error not a path of User
    t.setColumnFilter('nope', { type: 'equals', value: 1 })
    // @ts-expect-error object columns only allow custom
    t.setColumnFilter('address', { type: 'equals', value: 'x' })
    // @ts-expect-error loose values only allow equals / contains (+ custom)
    t.setColumnFilter('meta.raw', { type: 'range', value: {} })
  })

  it('ColumnFilter follows the value type', () => {
    type K<V> = ColumnFilter<V>['type']
    expectTypeOf<K<number>>().toEqualTypeOf<'range' | 'equals' | 'in' | 'custom'>()
    expectTypeOf<K<string | null>>().toEqualTypeOf<'equals' | 'in' | 'contains' | 'custom'>()
    expectTypeOf<K<boolean>>().toEqualTypeOf<'equals' | 'custom'>()
    expectTypeOf<K<{ a: 1 }>>().toEqualTypeOf<'custom'>()
    expectTypeOf<K<string[]>>().toEqualTypeOf<'equals' | 'in' | 'contains' | 'custom'>()
    expectTypeOf<Extract<ColumnFilter<number[]>, { type: 'equals' }>['value']>().toEqualTypeOf<
      number | null | undefined
    >()
  })

  it('FilterFor: arrays of primitives use their element kinds', () => {
    type K<V> = FilterFor<V>['type']
    expectTypeOf<K<string[]>>().toEqualTypeOf<'equals' | 'in' | 'contains'>()
    expectTypeOf<K<readonly number[] | null>>().toEqualTypeOf<'range' | 'equals' | 'in'>()
    expectTypeOf<FilterFor<{ a: 1 }[]>>().toBeNever()
  })

  it('a column def can declare a filter on an array column', () => {
    createTable({ data: users, columns: [{ key: 'tags', filter: { type: 'contains' } }] })
    // @ts-expect-error range is not a string filter
    createTable({ data: users, columns: [{ key: 'tags', filter: { type: 'range' } }] })
  })

  it('the slice and API are absent without the feature', () => {
    const t = createTable({ data: users, features: [] })
    // @ts-expect-error not installed
    t.setColumnFilter('name', undefined)
  })
})
