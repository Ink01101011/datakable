import { describe, expectTypeOf, it } from 'vitest'
import type { RowModel, RowModelStatus } from './types'

describe('RowModel (§6.6)', () => {
  it('status: fetching (fetcher) is separate from searching (searchFn)', () => {
    expectTypeOf<RowModelStatus>().toEqualTypeOf<
      'idle' | 'validating' | 'pending' | 'searching' | 'fetching' | 'error'
    >()
  })

  it('carries isInitialLoad', () => {
    expectTypeOf<RowModel<unknown>['isInitialLoad']>().toEqualTypeOf<boolean>()
  })
})
