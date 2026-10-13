import { describe, expect, it } from 'vitest'
import { userSchema } from '../ingest/test-schemas'
import { withSchema } from '../ingest/with-schema'
import { createTable } from '../table/create-table'

// Issue #11: a Row read through a Proxy-based store (Vue `ref` / `reactive`, Pinia, MobX). Vue's
// deep reactivity wraps every object it reads in a Proxy whose `get` trap is
// `Reflect.get(target, key, receiver)`, so getters and methods run with `this` = the proxy. `deep`
// mimics that: objects are wrapped (cached per target), functions and non-extensible objects are
// returned as they are, like Vue does.
function deep<T extends object>(target: T, cache = new WeakMap<object, object>()): T {
  const hit = cache.get(target)
  if (hit) return hit as T
  const p = new Proxy(target, {
    get(t, key, receiver) {
      const v = Reflect.get(t, key, receiver)
      return typeof v === 'object' && v !== null && Object.isExtensible(v) ? deep(v, cache) : v
    },
  })
  cache.set(target, p)
  return p
}

describe('Row through a reactive proxy (#11)', () => {
  it('getValue, valid, issues and getCellIssues read like on the plain row', () => {
    const table = createTable({
      schema: withSchema(userSchema),
      invalidRows: 'flag',
      data: [
        { id: 1, name: 'Mali', age: 30 },
        { id: 2, name: 'Niran', age: 'x' },
      ],
      rowKey: 'id',
      columns: [{ key: 'name' }, { key: 'age' }, { id: 'upper', accessor: (u) => u.name }],
    })
    const plain = table.getRowModel().rows
    const viaRef = deep({ value: table.getRowModel() }).value.rows
    const viaReactive = deep({ model: table.getRowModel() }).model.rows
    for (const rows of [viaRef, viaReactive]) {
      const [ok, bad] = rows
      expect(ok?.getValue('name')).toBe('Mali')
      expect(ok?.getValue('upper')).toBe('Mali')
      expect(ok?.valid).toBe(true)
      expect(ok?.issues).toEqual([])
      expect(ok?.getCellIssues('age')).toEqual([])
      expect(bad?.valid).toBe(false)
      expect(bad?.issues).toEqual(plain[1]?.issues)
      expect(bad?.getCellIssues('age')).toEqual(plain[1]?.getCellIssues('age'))
      expect(bad?.getCellIssues('age')).toHaveLength(1)
    }
  })

  it('keeps the row source out of string keys (Object.keys, JSON)', () => {
    const table = createTable({ data: [{ id: 1, name: 'Mali' }], rowKey: 'id' })
    const row = table.getRowModel().rows[0]
    expect(Object.keys(row as object)).toEqual(['key', 'index', 'original'])
    expect(JSON.parse(JSON.stringify(row))).toEqual({
      key: 1,
      index: 0,
      original: { id: 1, name: 'Mali' },
    })
  })
})
