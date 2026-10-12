import { describe, expectTypeOf, test } from 'vitest'
import type { ColumnDef } from './column-def'
import { table, type User } from './test-utils'

declare const users: User[]

describe('ColumnDef — valid columns (prototype: 11 valid cases)', () => {
  test('all valid cases compile in one columns array', () => {
    table({
      data: users,
      rowKey: 'id',
      columns: [
        { key: 'first', search: 1 },
        { key: 'age', filter: { type: 'range' } },
        { key: 'address.city', search: 0.5 },
        { key: 'address.geo.lat', filter: { type: 'range' } },
        { key: 'manager.name' },
        { key: 'tags' },
        { key: 'createdAt', filter: { type: 'range' } },
        { key: 'address', cell: ({ value }) => value.city },
        { key: 'friends', format: (v) => String(v.length) },
        { id: 'full', accessor: (u) => `${u.first} ${u.last}` },
      ],
    })
  })

  test('cell value is the exact path value type (contextual typing per column)', () => {
    table({
      data: users,
      rowKey: 'id',
      columns: [
        {
          key: 'address.geo',
          cell: ({ value, row }) => {
            expectTypeOf(value).toEqualTypeOf<{ lat: number; lng: number }>()
            expectTypeOf(row).toEqualTypeOf<User>()
            return String(value.lat)
          },
        },
        {
          key: 'manager.name',
          format: (value) => {
            expectTypeOf(value).toEqualTypeOf<string | null>()
            return value ?? ''
          },
        },
      ],
    })
  })

  test('derived column row is contextually typed', () => {
    table({
      data: users,
      rowKey: 'id',
      columns: [
        {
          id: 'full',
          accessor: (u) => {
            expectTypeOf(u).toEqualTypeOf<User>()
            return u.first
          },
        },
      ],
    })
  })

  test('other §4.1 column fields are accepted and typed by V', () => {
    table({
      data: users,
      rowKey: 'id',
      columns: [
        {
          key: 'age',
          header: 'Age',
          sortable: true,
          sortFn: (a, b) => {
            expectTypeOf(a).toEqualTypeOf<number>()
            return a - b
          },
          sortAlgorithm: 'radix',
          sensitive: true,
          invalidCell: () => '—',
        },
        { key: 'address', cell: ({ value }) => value.city, sortBy: (u) => u.address.city },
        { key: 'nick', filter: { type: 'contains' } },
        { key: 'active', filter: { type: 'equals' } },
        { key: 'id', filter: { type: 'in' } },
      ],
    })
  })

  test('cell return type is the generic R', () => {
    type Node = { kind: 'node' }
    const col: ColumnDef<User, Node> = { key: 'first', cell: () => ({ kind: 'node' }) }
    expectTypeOf(col).toExtend<ColumnDef<User, Node>>()
    // @ts-expect-error cell must return R
    const bad: ColumnDef<User, Node> = { key: 'first', cell: () => 'text' }
    expectTypeOf(bad).toExtend<ColumnDef<User, Node>>()
  })
})

describe('ColumnDef — invalid columns (prototype: 6 invalid cases)', () => {
  test('typo key', () => {
    // @ts-expect-error typo key
    table({ data: users, rowKey: 'id', columns: [{ key: 'frist' }] })
  })

  test('range filter on a string', () => {
    // @ts-expect-error range on string
    table({ data: users, rowKey: 'id', columns: [{ key: 'first', filter: { type: 'range' } }] })
  })

  test('object column without cell or format', () => {
    // @ts-expect-error object column without cell/format
    table({ data: users, rowKey: 'id', columns: [{ key: 'address' }] })
  })

  test('function column without cell or format', () => {
    // @ts-expect-error function column without cell/format
    table({ data: users, rowKey: 'id', columns: [{ key: 'onClick' }] })
  })

  test('nested typo', () => {
    // @ts-expect-error nested typo
    table({ data: users, rowKey: 'id', columns: [{ key: 'address.ctiy' }] })
  })

  test('bad rowKey', () => {
    // @ts-expect-error bad rowKey
    table({ data: users, rowKey: 'nope', columns: [] })
  })

  test('array of objects without cell or format', () => {
    // @ts-expect-error array-of-objects column without cell/format
    table({ data: users, rowKey: 'id', columns: [{ key: 'friends' }] })
  })

  test('sortFn is typed by the column value', () => {
    table({
      data: users,
      rowKey: 'id',
      // @ts-expect-error sortFn params are string for `first`, not number
      columns: [{ key: 'first', sortFn: (a: number, b: number) => a - b }],
    })
  })
})
