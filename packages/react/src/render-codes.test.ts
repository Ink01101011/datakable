import { buildDiagnostic, formatWhere, getOperation, listOperations } from '@datakable/core'
import { describe, expect, it } from 'vitest'
import { registerRenderOperations } from './render-codes'

describe('DK_RENDER_FAILED (§8.3, react)', () => {
  it('render:cell: where names the op and the slot; text names the column and row', () => {
    const d = buildDiagnostic('DK_RENDER_FAILED', {
      op: 'render:cell',
      slot: 'columns[2].cell',
      column: 'email',
      row: 7,
      errorName: 'TypeError',
    })
    expect(d.level).toBe('error')
    expect(formatWhere(d.where)).toBe('operation render:cell at columns[2].cell')
    expect(d.problem).toBe(
      'a component returned by columns[2].cell (column "email") threw TypeError while rendering ' +
        'row #7',
    )
    expect(d.impact).toMatch(/^that cell renders ⚠/)
    expect(d.fix.length).toBe(2)
    expect(d.fix[0]).toMatch(/context\.cause/)
    expect(d.fix[0]).toMatch(/column "email"/)
  })

  it('render:table: where is the op; text points at the parts outside the cells', () => {
    const d = buildDiagnostic('DK_RENDER_FAILED', { op: 'render:table' })
    expect(formatWhere(d.where)).toBe('operation render:table')
    expect(d.problem).toMatch(/table body threw/)
    expect(d.impact).toMatch(/Error state/)
    expect(d.fix.length).toBe(2)
  })
})

describe('render:* operations (§3.4)', () => {
  it('are registered by @datakable/react, idempotently', () => {
    expect(getOperation('render:table')).toBeUndefined()
    registerRenderOperations()
    expect(listOperations()).toEqual(expect.arrayContaining(['render:table', 'render:cell']))
    expect(() => registerRenderOperations()).not.toThrow()
    expect(getOperation('render:cell')).toEqual({ kind: 'sync', hot: false })
  })
})
