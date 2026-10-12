import { describe, expect, it } from 'vitest'
import { createTable } from '../table/create-table'
import { createDefaultFeatures, defaultFeatures } from './index'

type User = { name: string; age: number }
const users: User[] = [
  { name: 'Mali', age: 31 },
  { name: 'Anan', age: 25 },
  { name: 'Ploy', age: 40 },
]

describe('default preset (§3.3)', () => {
  it('is columnFilters, validity, search, sorting, pagination in that order', () => {
    expect(defaultFeatures.map((f) => f.name)).toEqual([
      'columnFilters',
      'validity',
      'search',
      'sorting',
      'pagination',
    ])
    expect(createDefaultFeatures().map((f) => f.stage)).toEqual([
      'filter',
      'filter',
      'search',
      'sort',
      'paginate',
    ])
  })

  it('createDefaultFeatures() returns fresh instances each call', () => {
    const a = createDefaultFeatures()
    const b = createDefaultFeatures()
    for (let i = 0; i < a.length; i++) expect(a[i]).not.toBe(b[i])
  })

  it("core createTable installs it when passed as features (core's own default stays none)", () => {
    const t = createTable({ data: users, features: defaultFeatures })
    expect(Object.keys(t.getState()).sort()).toEqual([
      'columnFilters',
      'pagination',
      'search',
      'sorting',
      'validity',
    ])
    t.toggleSort('age')
    expect(t.getRowModel().rows.map((r) => r.original.name)).toEqual(['Anan', 'Mali', 'Ploy'])
    const bare = createTable({ data: users })
    expect(bare.getState()).toEqual({})
  })
})
