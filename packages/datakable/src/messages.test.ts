import { buildDiagnostic, hasMessages } from '@datakable/core'
import { expect, it } from 'vitest'

it('datakable/messages installs the full production text (§8.2)', async () => {
  expect(hasMessages()).toBe(false)
  await import('./messages')
  expect(hasMessages()).toBe(true)
  const d = buildDiagnostic('DK_TABLE_DESTROYED', { method: 'setState' }, { dev: false })
  expect(d.problem).toBe('table.setState() was called after table.destroy()')
})
