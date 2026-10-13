import { describe, expectTypeOf, it } from 'vitest'
import {
  type ApiOf,
  createTable,
  type FetchOutcome,
  type SearchOutcome,
  type SearchState,
  type StateOf,
  search,
} from '../../index'
import { withSearchFn } from './with-search-fn'

type User = { name: string; age: number }
declare const users: User[]

describe('search() types', () => {
  it('adds the search slice and API', () => {
    type Fs = [ReturnType<typeof search>]
    expectTypeOf<StateOf<Fs, User>>().toEqualTypeOf<{ search: SearchState }>()
    expectTypeOf<ApiOf<Fs, User>['setSearch']>().toEqualTypeOf<
      (query: string) => Promise<SearchOutcome>
    >()
    const t = createTable({ data: users, features: [search({ threshold: 0.4 })] })
    expectTypeOf(t.getState().search.status).toEqualTypeOf<
      'idle' | 'pending' | 'searching' | 'error'
    >()
    expectTypeOf(t.flushSearch()).toEqualTypeOf<Promise<SearchOutcome>>()
    expectTypeOf(t.clearSearch).returns.toEqualTypeOf<void>()
    // @ts-expect-error the query is a string
    t.setSearch(1)
    // @ts-expect-error unknown option
    search({ treshold: 0.4 })
    search({ typing: { strategy: 'debounce', wait: { seconds: 1, ms: 500 }, behavior: 'leading' } })
    search({ typing: { strategy: 'throttle', wait: 100, minLength: 2, commitOn: 'enter' } })
    // @ts-expect-error unknown strategy
    search({ typing: { strategy: 'later' } })
  })

  it('searchFn is typed against the row type; refetch is a core method', () => {
    search<User>({
      searchFn: withSearchFn(({ query, rows, signal }) => {
        expectTypeOf(query).toEqualTypeOf<string>()
        expectTypeOf(rows).toEqualTypeOf<readonly User[]>()
        expectTypeOf(signal).toEqualTypeOf<AbortSignal>()
        return rows.filter((r) => r.age > 1)
      }),
    })
    search<User>({ searchFn: withSearchFn(async () => ({ keys: [1, 'a'] })) })
    // @ts-expect-error a result is rows or { keys }
    search<User>({ searchFn: withSearchFn(() => 1) })
    // @ts-expect-error searchFn takes a function wrapped with withSearchFn() (§6.3, §9.3)
    search<User>({ searchFn: () => [] })
    const t = createTable({ data: users, features: [search()] })
    expectTypeOf(t.refetch()).toEqualTypeOf<Promise<FetchOutcome>>()
  })

  it('search API is absent without the feature', () => {
    const t = createTable({ data: users, features: [] })
    // @ts-expect-error not installed
    t.setSearch('x')
  })
})
