import { describe, test } from 'vitest'
import { table, type User } from './test-utils'

// The six common column type errors (spec §4.1 / §4.3), explained in docs/how-to-fix/reading-type-errors.md.
// type-errors.test.ts compiles this file with the directives removed and pins each message, so
// keep every case on the single line under its `[E<n>]` marker.

declare const users: User[]

describe('the six common type errors', () => {
  test('E1 typo key', () => {
    // @ts-expect-error [E1] typo key
    table({ data: users, rowKey: 'id', columns: [{ key: 'frist' }] })
  })

  test('E2 nested typo', () => {
    // @ts-expect-error [E2] nested typo
    table({ data: users, rowKey: 'id', columns: [{ key: 'address.ctiy' }] })
  })

  test('E3 filter kind not allowed for the value type', () => {
    // @ts-expect-error [E3] range filter on a string
    table({ data: users, rowKey: 'id', columns: [{ key: 'first', filter: { type: 'range' } }] })
  })

  test('E4 object column without cell or format', () => {
    // @ts-expect-error [E4] object column without cell / format
    table({ data: users, rowKey: 'id', columns: [{ key: 'address' }] })
  })

  test('E5 function column without cell or format', () => {
    // @ts-expect-error [E5] function column without cell / format
    table({ data: users, rowKey: 'id', columns: [{ key: 'onClick' }] })
  })

  test('E6 bad rowKey', () => {
    // @ts-expect-error [E6] rowKey is not a path of the row
    table({ data: users, rowKey: 'nope', columns: [] })
  })

  test('E4b array-of-objects column reads like E4', () => {
    // @ts-expect-error [E4b] array-of-objects column without cell / format
    table({ data: users, rowKey: 'id', columns: [{ key: 'friends' }] })
  })
})

describe('hover targets (JSDoc on cell / format)', () => {
  test('optional and required forms', () => {
    table({
      data: users,
      rowKey: 'id',
      columns: [
        { key: 'first', cell: ({ value }) => value },
        { key: 'age', format: (value) => String(value) },
        { key: 'address', cell: ({ value }) => value.city },
        { key: 'friends', format: (value) => String(value.length) },
      ],
    })
  })
})
