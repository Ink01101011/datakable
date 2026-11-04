import { describe, expect, it } from 'vitest'
import { defineFeature } from '../feature/define'
import { sorting } from '../features/sorting/sorting'
import { errorBoundary } from '../intercept/boundary'
import { createInterceptorRuntime } from '../intercept/runtime'
import { createTable } from '../table/create-table'
import { buildDiagnostic } from './build'
import { expandProse, proseArg } from './prose'
import type { Diagnostic } from './types'

/** #92: a user value packed into a prose key (`'key|arg'`) keeps its `|` (and `%`). */
describe('prose key arguments with | (#92)', () => {
  it('a sortAlgorithm with | is printed whole', () => {
    const seen: Diagnostic[] = []
    const t = createTable({
      data: [{ a: 2 }, { a: 1 }],
      columns: [{ key: 'a', sortAlgorithm: 'fast|stable' as never }],
      features: [sorting()],
      onDiagnostic: (d) => seen.push(d),
    })
    t.toggleSort('a')
    t.getRowModel()
    const d = seen.find((x) => x.code === 'DK_OPTION_NO_EFFECT')
    expect(d?.details.reason).toBe(
      '"fast|stable" is not a sort algorithm (accepted: auto, tim, radix, counting, native, or a ' +
        'function); auto was used',
    )
  })

  it('escaped arguments round-trip, including % and the escape sequences themselves', () => {
    for (const v of ['a|b', '|', '%', '%7C', '%25|%7c', 'x||y', '']) {
      expect(expandProse(`unknown-op|${proseArg(v)}`, true)).toBe(
        `Unknown operation "${v}": register it with registerOperation()`,
      )
    }
    expect(expandProse(`boundary-twice|${proseArg('a|b')}|${proseArg('c%d')}`, true)).toBe(
      'A boundary interceptor is already installed ("a|b"); "c%d" was rejected',
    )
    // A value that spells another key is still a value, not a nested key.
    expect(expandProse(`unknown-op|${proseArg('page-size|3')}`, true)).toBe(
      'Unknown operation "page-size|3": register it with registerOperation()',
    )
    // Nested keys written by the library still expand.
    expect(expandProse('ranks|custom-threw', true)).toBe(
      'the custom algorithm threw, strings as collation ranks',
    )
  })

  it('unknown operation and unknown code keep a | in the name', () => {
    const rt = createInterceptorRuntime({ emit: () => {}, interceptors: [] })
    expect(() => rt.run('my|op' as never, {} as never, {} as never)).toThrow(
      'Unknown operation "my|op"',
    )
    rt.installBoundary(errorBoundary)
    expect(() => rt.installBoundary({ ...errorBoundary, name: 'mine|2' })).toThrow(
      `("${errorBoundary.name}"); "mine|2" was rejected`,
    )
    const d = buildDiagnostic('DK_NOT|DEFINED' as never, {} as never, { dev: true })
    expect(d.details.problem).toBe(
      'unknown diagnostic code "DK_NOT|DEFINED": define it with defineDiagnostic() first',
    )
  })

  it('a missing feature API method keeps a | in its name', () => {
    const seen: Diagnostic[] = []
    const bad = defineFeature({
      name: 'bad',
      stage: 'none',
      initialState: () => 0,
      createApi: () => {
        throw new Error('boom')
      },
    })
    const t = createTable({ data: [], features: [bad], onDiagnostic: (d) => seen.push(d) })
    ;(t as unknown as Record<string, () => void>)['go|now']?.()
    const d = seen.filter((x) => x.code === 'DK_FEATURE_FAILED').at(-1)
    expect(d?.details.fallback).toBe(
      'table.go|now() did nothing (the API of that feature was not installed)',
    )
  })
})
