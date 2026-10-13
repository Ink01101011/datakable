import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from '../../diagnostics/types'
import { createTable } from '../../table/create-table'
import { search } from './search'

// ex-search overridden to a build without `ExSearch` (§8.5 feature detection).
vi.mock('ex-search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ex-search')>()),
  ExSearch: undefined,
}))

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

const data = [
  { id: 0, name: 'Adams', city: 'Bangkok' },
  { id: 1, name: 'Ada', city: 'Chiang Mai' },
  { id: 2, name: 'Bob', city: 'Ada Town' },
  { id: 3, name: 'Ada', city: 'Phuket' },
  { id: 4, name: 'Cara', city: 'Bangkok' },
]

describe('search(): ex-search missing', () => {
  it('reports DK_DEP_INCOMPATIBLE once and falls back to exact / prefix / substring', async () => {
    const seen: Diagnostic[] = []
    const make = () =>
      createTable({
        data,
        onDiagnostic: (d) => {
          seen.push(d)
        },
        columns: [
          { key: 'name', search: 1 },
          { key: 'city', search: 0.5 },
        ],
        features: [search()],
      })
    const t = make()
    await t.setSearch('ADA')
    expect(t.getRowModel().rows.map((r) => r.original.id)).toEqual([1, 3, 0, 2])
    await t.setSearch('carx')
    expect(t.getRowModel().rows).toHaveLength(0)
    const t2 = make()
    await t2.setSearch('bob')
    expect(t2.getRowModel().rows.map((r) => r.index)).toEqual([2])
    const dep = seen.filter((d) => d.code === 'DK_DEP_INCOMPATIBLE')
    expect(dep).toHaveLength(1)
    expect(dep[0]?.details).toMatchObject({ dependency: 'ex-search', feature: 'search' })
  })
})
