import { describe, expect, it } from 'vitest'
import * as core from './core'
import * as main from './index'

describe('datakable', () => {
  it('re-exports react + core', () => {
    expect(main.useDataTable).toBeTypeOf('function')
    expect(core.VERSION).toBe(main.VERSION)
  })
})
