import { describe, expectTypeOf, it } from 'vitest'
import {
  type ApiOf,
  createTable,
  type PaginationApi,
  type PaginationState,
  pagination,
  type StateOf,
} from '../../index'

type Item = { sku: string; price: number }
declare const items: Item[]

describe('pagination() types', () => {
  it('StateOf / ApiOf give the pagination slice and API', () => {
    type Fs = [ReturnType<typeof pagination>]
    expectTypeOf<StateOf<Fs, Item>>().toEqualTypeOf<{ pagination: PaginationState }>()
    expectTypeOf<ApiOf<Fs, Item>>().toEqualTypeOf<PaginationApi>()
  })

  it('the table has the slice and the methods', () => {
    const t = createTable({ data: items, features: [pagination({ pageSize: 25 })] })
    expectTypeOf(t.getState().pagination).toEqualTypeOf<PaginationState>()
    expectTypeOf(t.setPageIndex).parameters.toEqualTypeOf<[number]>()
    expectTypeOf(t.getPageCount()).toEqualTypeOf<number>()
    expectTypeOf(t.canNextPage()).toEqualTypeOf<boolean>()
    // @ts-expect-error pageSize is a number
    pagination({ pageSize: '25' })
    // @ts-expect-error unknown option
    pagination({ pagesize: 25 })
  })

  it('without the feature, its slice and API are absent', () => {
    const t = createTable({ data: items, features: [] })
    // @ts-expect-error not installed
    t.nextPage()
  })
})
