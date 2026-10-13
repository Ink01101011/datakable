import { describe, expect, it } from 'vitest'
import type { OptionRule } from '../catalog/options'
import { tableOptions } from '../catalog/table-options'
import { READ_ONCE } from './read-once'

describe('READ_ONCE', () => {
  it('lists exactly the read-once rules of the table-options catalog', () => {
    const schema = tableOptions.schema as Readonly<Record<string, OptionRule>>
    const once = Object.keys(schema).filter((k) => schema[k]?.once)
    expect([...READ_ONCE].sort()).toEqual(once.sort())
  })
})
