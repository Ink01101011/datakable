import { describe, expectTypeOf, it } from 'vitest'
import {
  type ApiOf,
  createTable,
  type SearchOutcome,
  type SearchState,
  type StateOf,
  search,
} from '../../index'

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

  it('search API is absent without the feature', () => {
    const t = createTable({ data: users, features: [] })
    // @ts-expect-error not installed
    t.setSearch('x')
  })
})
