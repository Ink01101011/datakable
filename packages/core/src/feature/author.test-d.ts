import { describe, expectTypeOf, it } from 'vitest'
// A feature author's view: everything comes from the public entry point.
import {
  createTable,
  defineFeature,
  type FeatureTypes,
  type Path,
  type TableOptions,
} from '../index'

// R4 review: a feature written as "one file" against the public API only.
type OrderState<T> = { key: Path<T> | null; desc: boolean }
type OrderApi<T> = {
  orderBy(key: Path<T>, desc?: boolean): void
  getOrderKey(): Path<T> | null
}
interface OrderTypes extends FeatureTypes {
  state: OrderState<this['T']>
  api: OrderApi<this['T']>
}
const order = (opts: { desc?: boolean } = {}) =>
  defineFeature<'order', OrderTypes>({
    name: 'order',
    stage: 'sort',
    initialState: () => ({ key: null, desc: opts.desc ?? false }),
    createApi: (ctx) => ({
      orderBy: (key, desc = false) => ctx.setState({ key, desc }),
      getOrderKey: () => ctx.getState().key,
    }),
    rowModel: (indices) => indices,
  })

type Item = { sku: string; price: number; meta: { tag: string } }
declare const items: Item[]

describe('feature authoring (R4)', () => {
  it('a row-typed feature gives precise state and API types', () => {
    const t = createTable({ data: items, features: [order()] })
    expectTypeOf(t.getState().order).toEqualTypeOf<OrderState<Item>>()
    expectTypeOf(t.getState().order.key).toEqualTypeOf<Path<Item> | null>()
    expectTypeOf(t.orderBy).parameters.toEqualTypeOf<[Path<Item>, (boolean | undefined)?]>()
    expectTypeOf(t.getOrderKey()).toEqualTypeOf<Path<Item> | null>()
    t.orderBy('meta.tag', true)
    // @ts-expect-error not a path of Item
    t.orderBy('nope')
    // @ts-expect-error desc must be a boolean
    t.orderBy('sku', 'desc')
    // @ts-expect-error no such slice
    void t.getState().sorting
  })

  it('existing explicit <T, S> call sites without features still type-check', () => {
    type S = { rows: string[] }
    const t = createTable<Item, S>({ data: items, initialState: { rows: [] } })
    expectTypeOf(t.getState()).toEqualTypeOf<S>()
  })

  it('forwarded options (non-tuple feature list) never make the table `any`', () => {
    const opts: TableOptions<Item, { q: string }> = { data: items }
    const t = createTable(opts)
    expectTypeOf(t).not.toBeAny()
    expectTypeOf(t.getState()).toEqualTypeOf<{ q: string }>()
    // @ts-expect-error no feature API is known for a non-tuple list
    t.orderBy('sku')
    // A concrete S is kept when the wide list is passed explicitly.
    const t2 = createTable<Item, { q: string }, NonNullable<typeof opts.features>>(opts)
    expectTypeOf(t2.getState()).toEqualTypeOf<{ q: string }>()
  })

  it('partial explicit type arguments disable Fs inference (documented limitation)', () => {
    // `createTable<Item>(...)` fixes Fs to its default `[]`: features must then be spelled out
    // as the third type argument, or T left to inference.
    // @ts-expect-error Fs defaults to [] when T is given explicitly
    createTable<Item>({ data: items, features: [order()] })
    const t = createTable<Item, never, [ReturnType<typeof order>]>({
      data: [],
      features: [order()],
    })
    expectTypeOf(t.getOrderKey()).toEqualTypeOf<Path<Item> | null>()
  })
})
