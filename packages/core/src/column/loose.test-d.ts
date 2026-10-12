import { describe, expectTypeOf, test } from 'vitest'
import type { ColumnDef, FilterFor, LooseRow } from './column-def'
import type { Path, PathValue } from './path'
import { table } from './test-utils'

// biome-ignore-start lint/suspicious/noExplicitAny: loose-typed rows are the subject under test
type Mixed = { id: number; meta: Record<string, any>; extra: any; payload: unknown }
declare const anyRows: any[]
declare const recAny: Record<string, any>[]
// biome-ignore-end lint/suspicious/noExplicitAny: loose-typed rows are the subject under test
declare const recUnknown: Record<string, unknown>[]
declare const mixed: Mixed[]

describe('whole-row any (§4.2)', () => {
  test('is treated as Record<string, unknown>', () => {
    // biome-ignore lint/suspicious/noExplicitAny: the subject under test
    expectTypeOf<LooseRow<any>>().toEqualTypeOf<Record<string, unknown>>()
    expectTypeOf<LooseRow<{ a: 1 }>>().toEqualTypeOf<{ a: 1 }>()
  })

  test('any key path is usable and needs no cell', () => {
    table({ data: anyRows, rowKey: 'id', columns: [{ key: 'whatever.deep' }] })
  })

  test('filters are limited to equals / contains', () => {
    table({
      data: anyRows,
      rowKey: 'id',
      columns: [
        { key: 'a', filter: { type: 'equals' } },
        { key: 'b', filter: { type: 'contains' } },
      ],
    })
    // The measured §4.2 bug: this compiled silently with plain `any[]`.
    const key = 'whatever.deep'
    // @ts-expect-error range is not type-agnostic
    table({ data: anyRows, rowKey: 'id', columns: [{ key, filter: { type: 'range' } }] })
    // @ts-expect-error in is not type-agnostic
    table({ data: anyRows, rowKey: 'id', columns: [{ key: 'x', filter: { type: 'in' } }] })
  })

  test('derived column row is Record<string, unknown>', () => {
    // biome-ignore lint/suspicious/noExplicitAny: the subject under test
    const col: ColumnDef<any> = {
      id: 'x',
      accessor: (row) => {
        expectTypeOf(row).toEqualTypeOf<Record<string, unknown>>()
        return row.x
      },
    }
    expectTypeOf(col).not.toBeAny()
  })
})

describe('Record rows', () => {
  test('Record<string, any> accepts any path', () => {
    table({ data: recAny, rowKey: 'id', columns: [{ key: 'x.y' }] })
  })

  test('Record<string, unknown> values need no cell', () => {
    table({ data: recUnknown, rowKey: 'id', columns: [{ key: 'name' }] })
  })
})

describe('any / unknown fields inside a typed row', () => {
  test('need no cell and only allow loose filters', () => {
    table({
      data: mixed,
      rowKey: 'id',
      columns: [
        { key: 'extra' },
        { key: 'payload', filter: { type: 'contains' } },
        { key: 'meta.anything' },
      ],
    })
    // @ts-expect-error range on an unknown field
    table({ data: mixed, rowKey: 'id', columns: [{ key: 'payload', filter: { type: 'range' } }] })
  })

  test('known keys are still checked next to any fields', () => {
    // @ts-expect-error typo still caught next to any fields
    table({ data: mixed, rowKey: 'id', columns: [{ key: 'iid' }] })
  })

  test('paths and values', () => {
    expectTypeOf<'id' | 'extra' | 'payload' | 'meta' | 'meta.x'>().toExtend<Path<Mixed>>()
    expectTypeOf<PathValue<Mixed, 'extra'>>().toBeAny()
    expectTypeOf<PathValue<Mixed, 'payload'>>().toBeUnknown()
  })
})

describe('FilterFor', () => {
  test('maps value types to filter kinds', () => {
    type K<V> = FilterFor<V>['type']
    expectTypeOf<K<number>>().toEqualTypeOf<'range' | 'equals' | 'in'>()
    expectTypeOf<K<Date | null>>().toEqualTypeOf<'range' | 'equals' | 'in'>()
    expectTypeOf<K<string | undefined>>().toEqualTypeOf<'equals' | 'in' | 'contains'>()
    expectTypeOf<K<boolean>>().toEqualTypeOf<'equals'>()
    expectTypeOf<K<unknown>>().toEqualTypeOf<'equals' | 'contains'>()
    // biome-ignore lint/suspicious/noExplicitAny: the subject under test
    expectTypeOf<K<any>>().toEqualTypeOf<'equals' | 'contains'>()
    expectTypeOf<FilterFor<{ a: 1 }>>().toBeNever()
  })
})
