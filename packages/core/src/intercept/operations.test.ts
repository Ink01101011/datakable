import { describe, expect, it } from 'vitest'
import { getOperation, listOperations, registerOperation } from './operations'

declare module './operations' {
  interface Operations {
    'test:ext': { kind: 'sync'; input: undefined; output: undefined }
  }
}

describe('operation registry', () => {
  it('seeds the §3.4 ops with kind and hot flag', () => {
    expect(getOperation('table:init')).toEqual({ kind: 'sync', hot: false })
    expect(getOperation('data:ingest')).toEqual({ kind: 'sync|async', hot: false })
    expect(getOperation('async:request')).toEqual({ kind: 'async', hot: false })
    expect(getOperation('column:batch')).toEqual({ kind: 'sync', hot: true })
    expect(listOperations()).toEqual(
      expect.arrayContaining([
        'table:init',
        'table:setOptions',
        'table:destroy',
        'state:dispatch',
        'data:ingest',
        'pipeline:run',
        'pipeline:step',
        'column:batch',
        'async:request',
        'diagnostic:emit',
      ]),
    )
  })

  it('returns undefined for an unknown op', () => {
    expect(getOperation('nope:op')).toBeUndefined()
  })

  it('is extensible; identical re-registration is a no-op, a conflicting one throws', () => {
    registerOperation('test:ext', { kind: 'sync', hot: true })
    expect(getOperation('test:ext')).toEqual({ kind: 'sync', hot: true })
    expect(listOperations()).toContain('test:ext')
    expect(() => registerOperation('test:ext', { kind: 'sync', hot: true })).not.toThrow()
    // @ts-expect-error the kind must match the declared one
    expect(() => registerOperation('test:ext', { kind: 'async', hot: true })).toThrow(
      /already registered/,
    )
  })
})
