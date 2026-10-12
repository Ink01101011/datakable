import { getDiagnosticDefinition } from '@datakable/core'
import { describe, expect, it } from 'vitest'
import { reactDiagnostics } from './codes'

describe('@datakable/react diagnostic codes', () => {
  it.each(reactDiagnostics.map((d) => [d.code]))(
    '%s is in the catalog with where + fix',
    (code) => {
      const def = getDiagnosticDefinition(code as 'DK_UNSTABLE_COLUMNS')
      expect(def?.level).toBe('warn')
      const details = { renders: 2, option: 'fetcher' } as never
      expect(def?.where(details)).toBeTruthy()
      expect(def?.problem(details)).not.toBe('')
      expect(def?.fix(details).length).toBeGreaterThan(0)
    },
  )

  it('DK_UNSTABLE_OPTION has option-specific fixes', () => {
    const def = getDiagnosticDefinition('DK_UNSTABLE_OPTION')
    for (const option of ['data', 'fetcher', 'rowKey', 'features[0].searchFn']) {
      const d = { option, renders: 2 }
      expect(def?.where(d)).toEqual({ kind: 'option', path: option })
      expect(def?.impact(d)).not.toBe('')
      expect(def?.fix(d)[0]).not.toBe('')
    }
    expect(def?.fix({ option: 'fetcher', renders: 2 }).join(' ')).toMatch(/refetch\(\)/)
  })
})
