import { describe, expectTypeOf, it } from 'vitest'
import type { Path } from '../column'
import { createTable } from '../table/create-table'
import { defineFeature } from './define'
import type { AnyFeature, ApiOf, Feature, FeatureTypes, StateOf } from './types'

// Prototype features (brainstorm `typeproto/feat.ts`), now written with the real defineFeature.
type SortState<T> = { by: { key: Path<T>; desc: boolean }[] }
type SortApi<T> = { toggleSort(key: Path<T>): void }
interface SortingTypes extends FeatureTypes {
  state: SortState<this['T']>
  api: SortApi<this['T']>
}
const sorting = () =>
  defineFeature<'sorting', SortingTypes>({
    name: 'sorting',
    stage: 'sort',
    initialState: () => ({ by: [] }),
    createApi: (ctx) => ({
      toggleSort: (key) => ctx.setState((s) => ({ by: [{ key, desc: !s.by[0]?.desc }] })),
    }),
  })

interface PaginationTypes extends FeatureTypes {
  state: { pageIndex: number; pageSize: number }
  api: { setPage(i: number): void; nextPage(): void }
}
const pagination = () =>
  defineFeature<'pagination', PaginationTypes>({
    name: 'pagination',
    stage: 'paginate',
    initialState: () => ({ pageIndex: 0, pageSize: 10 }),
    createApi: (ctx) => ({
      setPage: (i) => ctx.setState((s) => ({ ...s, pageIndex: i })),
      nextPage: () => ctx.setState((s) => ({ ...s, pageIndex: s.pageIndex + 1 })),
    }),
    rowModel: (indices, s) => indices.subarray(s.pageIndex * s.pageSize),
  })

// A third-party feature (selection — the Spec 2 shape).
type SelApi<T> = { selectRow(row: T, mods?: { ctrl?: boolean; shift?: boolean }): void }
interface SelectionTypes extends FeatureTypes {
  state: { selected: Set<string> }
  api: SelApi<this['T']>
}
const selection = () =>
  defineFeature<'selection', SelectionTypes>({
    name: 'selection',
    stage: 'none',
    initialState: () => ({ selected: new Set<string>() }),
    createApi: () => ({ selectRow: () => {} }),
  })

type User = { id: number; name: string }
declare const users: User[]
declare const user: User

describe('feature types (prototype checks)', () => {
  it('installed features: typed API and state slices', () => {
    const t = createTable({ data: users, features: [sorting(), pagination()] })
    t.toggleSort('name')
    t.nextPage()
    const s = t.getState()
    expectTypeOf(s.sorting.by).toEqualTypeOf<{ key: 'id' | 'name'; desc: boolean }[]>()
    expectTypeOf(s.pagination.pageIndex).toEqualTypeOf<number>()
    // @ts-expect-error not a key of User
    t.toggleSort('nope')
    // @ts-expect-error selection not installed → no api
    t.selectRow(user)
    // @ts-expect-error selection not installed → no state
    void s.selection
    // core methods are still there
    expectTypeOf(t.subscribe).toBeFunction()
  })

  it('API parameters are typed against T', () => {
    const t2 = createTable({ data: users, features: [sorting(), selection()] })
    t2.selectRow(user, { shift: true })
    // @ts-expect-error row must be a User
    t2.selectRow({ foo: 1 })
    expectTypeOf(t2.getState().selection.selected).toEqualTypeOf<Set<string>>()
  })

  it('initialState / state / setState are typed by the installed slices', () => {
    const t = createTable({
      data: users,
      features: [sorting()],
      initialState: { sorting: { by: [{ key: 'id', desc: true }] } },
    })
    t.setState({ sorting: { by: [] } })
    // @ts-expect-error not a key of User
    t.setState({ sorting: { by: [{ key: 'nope', desc: true }] } })
    createTable({
      data: users,
      features: [sorting()],
      // @ts-expect-error not a key of User
      state: { sorting: { by: [{ key: 'x', desc: false }] } },
    })
  })

  it('features are fixed at creation: setOptions does not take them', () => {
    const t = createTable({ data: users, features: [sorting()] })
    // @ts-expect-error features are read once, at creation
    t.setOptions({ features: [] })
  })

  it('StateOf / ApiOf intersect only the listed features', () => {
    type Fs = [ReturnType<typeof sorting>, ReturnType<typeof pagination>]
    expectTypeOf<StateOf<Fs, User>>().toEqualTypeOf<
      { sorting: SortState<User> } & {
        pagination: { pageIndex: number; pageSize: number }
      }
    >()
    expectTypeOf<ApiOf<Fs, User>['toggleSort']>().parameters.toEqualTypeOf<['id' | 'name']>()
    expectTypeOf<ApiOf<[], User>>().toEqualTypeOf<unknown>()
  })

  it('without features (and without S) the state stays open, as before', () => {
    const t = createTable({ data: users })
    expectTypeOf(t.getState()).toEqualTypeOf<Record<string, unknown>>()
  })

  it('an explicit S is kept and combined with the installed slices', () => {
    const t = createTable<User, { query: string }, [ReturnType<typeof sorting>]>({
      data: users,
      features: [sorting()],
    })
    expectTypeOf(t.getState().query).toEqualTypeOf<string>()
    expectTypeOf(t.getState().sorting).toEqualTypeOf<SortState<User>>()
  })
})

describe('defineFeature', () => {
  it('infers state / API of a feature that does not depend on T', () => {
    const counter = defineFeature({
      name: 'counter',
      stage: 'none',
      initialState: () => ({ n: 0 }),
      createApi: (ctx) => ({
        increment: () => ctx.setState((s) => ({ n: s.n + 1 })),
        count: () => ctx.getState().n,
      }),
    })
    expectTypeOf(counter.name).toEqualTypeOf<'counter'>()
    const t = createTable({ data: users, features: [counter] })
    expectTypeOf(t.count()).toEqualTypeOf<number>()
    expectTypeOf(t.getState().counter).toEqualTypeOf<{ n: number }>()
  })

  it('checks hooks against the declared types', () => {
    defineFeature<'p', PaginationTypes>({
      name: 'p',
      stage: 'paginate',
      // @ts-expect-error pageSize missing
      initialState: () => ({ pageIndex: 0 }),
      createApi: () => ({ setPage: () => {}, nextPage: () => {} }),
    })
    defineFeature<'p', PaginationTypes>({
      name: 'p',
      // @ts-expect-error unknown stage
      stage: 'group',
      initialState: () => ({ pageIndex: 0, pageSize: 1 }),
      createApi: () => ({ setPage: () => {}, nextPage: () => {} }),
    })
    defineFeature<'p', PaginationTypes>({
      name: 'p',
      stage: 'paginate',
      initialState: () => ({ pageIndex: 0, pageSize: 1 }),
      createApi: () => ({ setPage: () => {}, nextPage: () => {} }),
      // @ts-expect-error rowModel returns indices
      rowModel: () => [1, 2],
    })
  })

  it('a Feature is assignable to the list constraint', () => {
    expectTypeOf(sorting()).toExtend<AnyFeature>()
    expectTypeOf(sorting()).toExtend<Feature<'sorting', SortingTypes>>()
  })
})
