import { describe, expect, it } from 'vitest'
import * as core from './core'
import * as main from './index'
import * as react from './react'

describe('datakable', () => {
  it('the root is framework-free: core + the default-preset createTable, no React APIs (#63)', () => {
    expect(main.createTable).toBeTypeOf('function')
    expect(main.createDefaultFeatures).toBeTypeOf('function')
    expect(core.VERSION).toBe(main.VERSION)
    for (const name of ['useDataTable', 'DataTable', 'renderMessages', 'reactDiagnostics'])
      expect(main).not.toHaveProperty(name)
  })

  it('datakable/react = the root + the React layer, with the default preset', () => {
    expect(react.useDataTable).toBeTypeOf('function')
    expect(react.DataTable).toBeTypeOf('function')
    // The preset createTable, not the bare core one re-exported by @datakable/react.
    expect(react.createTable).toBe(main.createTable)
    for (const name of Object.keys(main)) expect(react).toHaveProperty(name)
  })
})
