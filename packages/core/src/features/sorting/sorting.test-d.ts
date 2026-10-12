import { describe, expectTypeOf, it } from 'vitest'
// A user's view: everything comes from the public entry point.
import {
  type ApiOf,
  createTable,
  type Path,
  type SortDirection,
  type SortingState,
  type StateOf,
  sorting,
} from '../../index'

type User = {
  id: number
  name: string
  joined: Date
  address: { city: string }
  friends: { id: number }[]
}
declare const users: User[]

describe('sorting() types', () => {
  it('state and API are typed against the row type', () => {
    const t = createTable({ data: users, features: [sorting()] })
    expectTypeOf(t.getState().sorting).toEqualTypeOf<SortingState<User>>()
    expectTypeOf(t.getState().sorting.by[0]?.id).toEqualTypeOf<Path<User> | undefined>()
    t.toggleSort('name')
    t.toggleSort('address.city', { multi: true })
    t.setSorting([{ id: 'joined', desc: true }])
    t.clearSorting()
    expectTypeOf(t.getSortDirection('id')).toEqualTypeOf<SortDirection | false>()
    // @ts-expect-error not a path of User
    t.toggleSort('nope')
    // @ts-expect-error multi must be a boolean
    t.toggleSort('name', { multi: 'yes' })
    // @ts-expect-error desc is required
    t.setSorting([{ id: 'name' }])
  })

  it('StateOf / ApiOf carry the slice and the API only when installed', () => {
    type Fs = [ReturnType<typeof sorting>]
    expectTypeOf<StateOf<Fs, User>>().toEqualTypeOf<{ sorting: SortingState<User> }>()
    expectTypeOf<ApiOf<Fs, User>['toggleSort']>().parameters.toEqualTypeOf<
      [Path<User>, ({ multi?: boolean } | undefined)?]
    >()
    const bare = createTable({ data: users })
    // @ts-expect-error sorting is not installed
    bare.toggleSort('name')
  })

  it('options are typed', () => {
    sorting({ locale: 'th' })
    sorting({ locale: ['th', 'en'] })
    // @ts-expect-error locale is a BCP 47 tag or a list of them
    sorting({ locale: 1 })
  })

  it('an object column is sortable only with sortFn or sortBy (§6.4)', () => {
    createTable({
      data: users,
      columns: [
        // primitives / Date need nothing
        { key: 'name', sortable: true },
        { key: 'joined', sortable: true },
        // object columns not marked sortable stay valid
        { key: 'address', cell: ({ value }) => value.city },
        { key: 'address', cell: ({ value }) => value.city, sortable: false },
        // object columns with a sort override
        {
          key: 'address',
          cell: ({ value }) => value.city,
          sortable: true,
          sortFn: (a, b) => a.city.localeCompare(b.city),
        },
        {
          key: 'friends',
          format: (v) => String(v.length),
          sortable: true,
          sortBy: (u) => u.friends.length,
        },
      ],
    })
    createTable({
      data: users,
      // @ts-expect-error object column marked sortable without sortFn / sortBy
      columns: [{ key: 'address', cell: ({ value }) => value.city, sortable: true }],
    })
    createTable({
      data: users,
      // @ts-expect-error array-of-objects column marked sortable without sortFn / sortBy
      columns: [{ key: 'friends', format: (v) => String(v.length), sortable: true }],
    })
  })
})
