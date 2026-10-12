import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from '../diagnostics/types'
import { createTable } from './create-table'

/**
 * §3.4 `optionValidator`, changed 2026-10-13 for §9.3: the option validator (catalog, table-options
 * schema, did-you-mean) runs in development only. A production build keeps only what correctness
 * needs: `setOptions` still keeps the previous value of every read-once option.
 */
vi.mock('../diagnostics/env', () => ({ DEV: false }))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('production: option validation is off', () => {
  it('unknown and invalid options are neither reported nor thrown', () => {
    const seen: Diagnostic[] = []
    const t = createTable({
      data: [{ id: 1 }],
      onDiagnostic: (d) => seen.push(d),
      // biome-ignore lint/suspicious/noExplicitAny: an unknown option on purpose
      ...({ dataa: [] } as any),
      timeout: -1,
    })
    expect(t.getRowModel().rows).toHaveLength(1)
    expect(seen.map((d) => d.code)).toEqual([])
  })

  it('read-once options keep their first value on setOptions', () => {
    const t = createTable({ name: 'first', data: [{ id: 1 }], timeout: 1000, strict: false })
    t.setOptions({ name: 'second', timeout: 5, strict: true, columns: [{ key: 'id' }] })
    expect(t.getOptions()).toMatchObject({ name: 'first', timeout: 1000, strict: false })
    expect(t.getOptions().columns).toEqual([{ key: 'id' }])
  })

  it('a read-once option absent at creation stays absent', () => {
    const t = createTable({ data: [{ id: 1 }] })
    t.setOptions({ name: 'late' })
    expect('name' in t.getOptions()).toBe(false)
  })
})
