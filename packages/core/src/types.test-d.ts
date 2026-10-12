import { expectTypeOf, test } from 'vitest'
import type { ColumnKey } from './types'

type User = { id: number; name: string; 0: boolean }

test('ColumnKey keeps only string keys', () => {
  expectTypeOf<ColumnKey<User>>().toEqualTypeOf<'id' | 'name'>()
})
