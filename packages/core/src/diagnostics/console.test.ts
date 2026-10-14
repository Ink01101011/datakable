import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTable } from '../table/create-table'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('development console sink', () => {
  // The Edge Runtime (Next middleware, Vercel Edge) console has log/info/warn/error/debug only.
  it('prints the grouped text without console.groupCollapsed / groupEnd (#53)', () => {
    const c = console as unknown as Record<string, unknown>
    const saved = { groupCollapsed: c.groupCollapsed, groupEnd: c.groupEnd }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    c.groupCollapsed = undefined
    c.groupEnd = undefined
    try {
      const t = createTable({ data: [{ id: 1 }], rowKey: 'id', columns: [{ key: 'zzz' as never }] })
      t.getRowModel()
    } finally {
      c.groupCollapsed = saved.groupCollapsed
      c.groupEnd = saved.groupEnd
    }
    expect(error).not.toHaveBeenCalled()
    const printed = warn.mock.calls.map((args) => String(args[0]))
    const block = printed.find((s) => s.includes('DK_COLUMN_PATH_NOT_FOUND'))
    // Header and body in one call, in the §8.1 layout.
    expect(block).toMatch(/^⚠ \[DataKable table#\d+\] DK_COLUMN_PATH_NOT_FOUND: .*\n {2}where /)
    expect(block).toContain('\n  fix     1. ')
  })
})
