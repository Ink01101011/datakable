import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from '../../diagnostics/types'
import { createTable } from '../../table/create-table'
import { sorting } from './sorting'

// exsorted overridden to a build without `radixSort` (§8.5 feature detection).
vi.mock('exsorted/radix', () => ({ radixSort: undefined }))

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

describe('sorting(): exsorted capability missing', () => {
  it('reports DK_DEP_INCOMPATIBLE once and sorts natively (still stable, missing last)', () => {
    const seen: Diagnostic[] = []
    const make = () =>
      createTable({
        data: [3, null, 1, 3, 2].map((a, id) => ({ id, a })),
        columns: [{ key: 'a' }],
        features: [sorting({ debug: true, algorithm: 'radix' })],
        onDiagnostic: (d) => {
          seen.push(d)
        },
      })
    const t = make()
    t.setSorting([{ id: 'a', desc: true }])
    expect(t.getRowModel().rows.map((r) => r.original.id)).toEqual([0, 3, 4, 2, 1])
    make().toggleSort('a')
    const dep = seen.filter((d) => d.code === 'DK_DEP_INCOMPATIBLE')
    expect(dep).toHaveLength(1)
    expect(dep[0]?.where).toEqual({ kind: 'feature', name: 'sorting' })
    expect(dep[0]?.details).toMatchObject({ dependency: 'exsorted' })
    const strategy = seen.find((d) => d.code === 'DK_SORT_STRATEGY')
    expect(strategy?.details).toMatchObject({ algorithm: 'native' })
  })
})
