import { describe, expect, it } from 'vitest'
import { VERSION } from './index'

describe('@datakable/core', () => {
  it('exposes a version', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })
})
