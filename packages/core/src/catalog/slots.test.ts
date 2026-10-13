import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from '../diagnostics/types'
import { defineFeature } from '../feature/define'
import type { AnyFeature } from '../feature/types'
import { createTable } from '../table/create-table'
import { defineSlot, describeReturn, formatSlot, getSlot, matchesSlot } from './slots'

let seen: Diagnostic[]
const onDiagnostic = (d: Diagnostic) => {
  seen.push(d)
}
const codes = () => seen.map((d) => d.code)
const only = (code: string) => {
  const d = seen.filter((x) => x.code === code)
  expect(d).toHaveLength(1)
  return d[0] as Diagnostic
}

beforeEach(() => {
  seen = []
  for (const m of ['error', 'warn', 'info', 'log', 'groupCollapsed', 'group', 'groupEnd'] as const)
    vi.spyOn(console, m).mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('defineSlot', () => {
  it('registers a callback return contract, readable by name', () => {
    const slot = defineSlot({ name: 'test:label', returns: 'string', fallback: 'coerced' })
    expect(getSlot('test:label')).toBe(slot)
    expect(getSlot('test:nope')).toBeUndefined()
  })

  it('the built-in format slot returns a string', () => {
    expect(formatSlot).toMatchObject({ name: 'format', returns: 'string' })
    expect(getSlot('format')).toBe(formatSlot)
  })

  it('a slot is never redefined with another contract', () => {
    defineSlot({ name: 'test:twice', returns: 'number' })
    expect(defineSlot({ name: 'test:twice', returns: 'number' }).returns).toBe('number')
    expect(() => defineSlot({ name: 'test:twice', returns: 'string' })).toThrow(/test:twice/)
  })

  it.each([
    ['string', 'a', true],
    ['string', 1, false],
    ['number', 1, true],
    ['number', '1', false],
    ['boolean', false, true],
    ['boolean', 0, false],
    ['sync', 1, true],
    ['sync', Promise.resolve(1), false],
    // biome-ignore lint/suspicious/noThenProperty: a hand-made thenable is the case under test
    ['sync', { then: () => {} }, false],
  ] as const)('matchesSlot(%s, %o) is %s', (returns, value, ok) => {
    expect(matchesSlot({ returns }, value)).toBe(ok)
  })

  it.each([
    [1, 'a number'],
    [undefined, 'undefined'],
    [null, 'null'],
    [[1], 'an Array'],
    [{}, 'an Object'],
    [Promise.resolve(), 'a Promise'],
    [new Float64Array(1), 'a Float64Array'],
    [Object.create(null), 'an object'],
  ])('describeReturn(%o) = %s (a type, never the value)', (value, text) => {
    expect(describeReturn(value)).toBe(text)
  })
})

/** Reads the formatted values of `column` in a filter step (what search does). */
const reader = (column: string): AnyFeature =>
  defineFeature({
    name: 'reader',
    stage: 'filter',
    initialState: () => ({}),
    createApi: () => ({}),
    rowModel: (indices, _s, ctx) => {
      ctx.getFormattedValues(column)
      return indices
    },
  }) as AnyFeature

type R = { id: string; n: number }
const rows = (n: number): R[] => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, n: i }))

describe('DK_CALLBACK_BAD_RETURN (format)', () => {
  it('format returning a non-string: one warning per column batch, values coerced', () => {
    const format = vi.fn((v: unknown) => ((v as number) % 2 === 0 ? (v as number) * 10 : `#${v}`))
    let formatted: readonly string[] = []
    const capture = defineFeature({
      name: 'capture',
      stage: 'filter',
      initialState: () => ({}),
      createApi: () => ({}),
      rowModel: (indices, _s, ctx) => {
        formatted = ctx.getFormattedValues('n') ?? []
        return indices
      },
    }) as AnyFeature
    const t = createTable({
      data: rows(5),
      onDiagnostic,
      columns: [{ key: 'id' }, { key: 'n', format: format as never }],
      features: [capture],
    })
    t.getRowModel()
    expect(formatted).toEqual(['0', '#1', '20', '#3', '40'])
    const d = only('DK_CALLBACK_BAD_RETURN')
    expect(d.level).toBe('warn')
    expect(d.where).toEqual({ kind: 'option', path: 'columns[1].format' })
    expect(d.details).toMatchObject({
      slot: 'columns[1].format',
      column: 'n',
      expected: 'a string',
      received: 'a number',
      count: 3,
      rows: [0, 2, 4],
    })
    expect(d.problem).toMatch(/columns\[1\]\.format/)
    expect(d.problem).toMatch(/3 rows/)
    expect(d.impact).toMatch(/default formatter/)
    expect(d.fix[0]).toMatch(/String\(/)
  })

  it('format returning strings reports nothing', () => {
    const t = createTable({
      data: rows(3),
      onDiagnostic,
      columns: [{ key: 'n', format: (v: number) => `${v}` }],
      features: [reader('n')],
    })
    t.getRowModel()
    expect(codes()).toEqual([])
  })

  it('never carries the returned value (only its type)', () => {
    const t = createTable({
      data: [{ id: 'a', n: 1 }],
      onDiagnostic,
      columns: [{ key: 'n', format: (() => ({ secret: 'alice@example.com' })) as never }],
      features: [reader('n')],
    })
    t.getRowModel()
    const d = only('DK_CALLBACK_BAD_RETURN')
    expect(JSON.stringify(d)).not.toContain('alice')
    expect(d.details).toMatchObject({ received: 'an Object' })
  })
})
