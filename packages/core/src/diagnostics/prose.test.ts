import { describe, expect, it } from 'vitest'
import { buildDiagnostic } from './build'
import { hasMessages, installMessages } from './catalog'
import { expandProse, proseMessages } from './prose'
import '../index'

const details = {
  slot: 'columns[0].accessor',
  column: 'id',
  rows: [1],
  count: 1,
  fallback: 'cells-undefined',
}

describe('detail prose keys (§8.2, §9.3)', () => {
  it('production without messages keeps the key; development and installed messages read the sentence', () => {
    expect(hasMessages()).toBe(false)
    // Production without `@datakable/core/messages`: a key, never silent (code, where, details).
    const bare = buildDiagnostic('DK_CALLBACK_FAILED', details, { dev: false })
    expect(bare.code).toBe('DK_CALLBACK_FAILED')
    expect(bare.where).toEqual({ kind: 'option', path: 'columns[0].accessor' })
    expect(bare.details).toMatchObject({ fallback: 'cells-undefined' })
    expect(bare.impact).toBe('')

    // Development: the sentence, in the details and in the text.
    const dev = buildDiagnostic('DK_CALLBACK_FAILED', details, { dev: true })
    expect(dev.details).toMatchObject({ fallback: 'the failed cells read as undefined' })
    expect(dev.impact).toContain('the failed cells read as undefined')

    // Production with the messages installed: exactly the development reading.
    installMessages(proseMessages)
    const full = buildDiagnostic('DK_CALLBACK_FAILED', details, { dev: false })
    expect(full.details).toEqual(dev.details)
  })

  it('arguments, nested keys and unknown text', () => {
    expect(expandProse('page-size|10', true)).toBe('pageSize was replaced by 10')
    expect(expandProse('ranks|custom-threw', true)).toBe(
      'the custom algorithm threw, strings as collation ranks',
    )
    expect(expandProse('auto-ranked-range|42', true)).toBe(
      'auto: collation ranks of a string column, safe integers, key range 42 ≤ 4n',
    )
    // A plugin's own fallback text, and an inherited property name, stay as written.
    expect(expandProse('kept the old rows', true)).toBe('kept the old rows')
    expect(expandProse('constructor', true)).toBe('constructor')
  })

  it('a placeholder key without its argument expands to an empty argument, never throws', () => {
    expect(expandProse('page-size', true)).toBe('pageSize was replaced by ')
  })

  it('every sentence is non-empty and every key is a plain kebab name', () => {
    for (const [k, v] of Object.entries(proseMessages)) {
      expect(k).toMatch(/^[a-z][a-z0-9-]*$/)
      expect(v.length).toBeGreaterThan(5)
    }
  })
})
