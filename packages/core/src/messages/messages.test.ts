import { describe, expect, it } from 'vitest'
import { slotDiagnostics } from '../catalog/slots'
import { buildDiagnostic } from '../diagnostics/build'
import { hasMessages, listDiagnosticCodes } from '../diagnostics/catalog'
import { comparatorDiagnostics } from '../features/sorting/codes'
import { stepDiagnostics } from '../pipeline/dev-checks'
import { dataMutationDiagnostics } from '../table/data-mutation'
import '../index'

describe('@datakable/core/messages (§8.2)', () => {
  it('production diagnostics have no text until messages are installed, then full text', async () => {
    expect(hasMessages()).toBe(false)
    const before = buildDiagnostic('DK_TABLE_DESTROYED', { method: 'setState' }, { dev: false })
    expect(before.problem).toBe('')
    expect(before.fix).toEqual([])

    const { allMessages } = await import('./index')
    expect(hasMessages()).toBe(true)
    const after = buildDiagnostic('DK_TABLE_DESTROYED', { method: 'setState' }, { dev: false })
    expect(after.problem).toBe('table.setState() was called after table.destroy()')
    expect(after.impact).not.toBe('')
    expect(after.fix.length).toBeGreaterThan(0)
    // Redaction and the docs URL stay production-shaped.
    expect(after.docs).toContain('?v=')

    // Every code a production build can emit has message text; dev-only codes are never emitted
    // in production, so they keep their text on the (dev-only) definition.
    const devOnly = new Set<string>(
      [
        ...slotDiagnostics,
        ...comparatorDiagnostics,
        ...stepDiagnostics,
        ...dataMutationDiagnostics,
      ].map((d) => d.code),
    )
    const covered = new Set(allMessages.flatMap((m) => Object.keys(m)))
    const missing = listDiagnosticCodes().filter((c) => !devOnly.has(c) && !covered.has(c))
    expect(missing).toEqual([])
  })
})
