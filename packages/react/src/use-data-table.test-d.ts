import { expectTypeOf, test } from 'vitest'
import { type UseDataTableResult, useDataTable } from './use-data-table'

test('infers T from data', () => {
  type User = { id: number; name: string }
  const data: User[] = []
  expectTypeOf(useDataTable({ data })).toEqualTypeOf<UseDataTableResult<User>>()
})
