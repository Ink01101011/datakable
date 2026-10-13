import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from '../../diagnostics/types'
import '../../messages'
import { createTable } from '../../table/create-table'
import { pagination } from './pagination'

/**
 * #13: production drops the option validator (§9.3), so `pagination({ pageSize })` is not checked at
 * creation. An invalid page size must still be replaced (no recursion, no empty table) and reported.
 */
vi.mock('../../diagnostics/env', () => ({ DEV: false }))

afterEach(() => {
  vi.restoreAllMocks()
})

const data = [{ id: 1 }, { id: 2 }, { id: 3 }]

describe('production: an invalid pageSize option (#13)', () => {
  it.each([0, Number.NaN, -5, 2.5, '5' as unknown as number])(
    'pageSize %s: default page size, one DK_INVALID_PAGINATION with where and fix',
    (pageSize) => {
      const seen: Diagnostic[] = []
      const t = createTable({
        data,
        features: [pagination({ pageSize })],
        onDiagnostic: (d) => seen.push(d),
      })
      expect(t.getState().pagination).toEqual({ pageIndex: 0, pageSize: 10 })
      expect(t.getRowModel().rows).toHaveLength(3)
      expect(t.getPageCount()).toBe(1)
      expect(t.canNextPage()).toBe(false)
      expect(seen.map((d) => d.code)).toEqual(['DK_INVALID_PAGINATION'])
      const d = seen[0] as Diagnostic
      expect(d.where).toEqual({ kind: 'feature', name: 'pagination' })
      expect(d.details).toMatchObject({ source: 'option', field: 'pageSize' })
      expect(d.fix.length).toBeGreaterThan(0)
      expect(d.fix[0]).toContain('pagination({ pageSize })')

      // The table keeps working: a valid size applies, a bad state slice falls back to the last valid size.
      t.setPageSize(2)
      expect(t.getRowModel().rows).toHaveLength(2)
      t.setState({ pagination: { pageIndex: 0, pageSize: 0 } })
      expect(t.getState().pagination).toEqual({ pageIndex: 0, pageSize: 2 })
      expect(seen.map((x) => x.code)).not.toContain('DK_INTERCEPTOR_FAILED')
    },
  )

  it('a valid pageSize option reports nothing', () => {
    const seen: Diagnostic[] = []
    const t = createTable({
      data,
      features: [pagination({ pageSize: 2 })],
      onDiagnostic: (d) => seen.push(d),
    })
    expect(t.getRowModel().rows).toHaveLength(2)
    expect(seen).toEqual([])
  })
})
