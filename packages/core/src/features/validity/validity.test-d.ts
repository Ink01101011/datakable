import { describe, expectTypeOf, it } from 'vitest'
import {
  type ApiOf,
  createTable,
  type InvalidCellContext,
  type RowIssue,
  type StateOf,
  type ValidityApi,
  type ValidityState,
  validity,
} from '../../index'

type Item = { sku: string; price: number }
declare const items: Item[]

describe('validity() types', () => {
  it('StateOf / ApiOf give the validity slice and API', () => {
    type Fs = [ReturnType<typeof validity>]
    expectTypeOf<StateOf<Fs, Item>>().toEqualTypeOf<{ validity: ValidityState }>()
    expectTypeOf<ApiOf<Fs, Item>>().toEqualTypeOf<ValidityApi>()
    expectTypeOf<ValidityState>().toEqualTypeOf<'all' | 'valid' | 'invalid'>()
  })

  it('the table has setValidity; a value outside the union is a compile error', () => {
    const t = createTable({ data: items, features: [validity()] })
    expectTypeOf(t.getState().validity).toEqualTypeOf<ValidityState>()
    t.setValidity('invalid')
    // @ts-expect-error not a validity value
    t.setValidity('broken')
  })

  it('without validity() there is no setValidity', () => {
    const t = createTable({ data: items, features: [] })
    // @ts-expect-error validity is not installed
    t.setValidity('valid')
  })

  it('InvalidCellContext carries the cell issues', () => {
    expectTypeOf<InvalidCellContext['issues']>().toEqualTypeOf<readonly RowIssue[]>()
  })
})
