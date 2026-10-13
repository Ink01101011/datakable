import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatakableConfigError } from '../diagnostics/build'
import type { Diagnostic } from '../diagnostics/types'
import { defineFeature } from '../feature/define'
import type { AnyFeature } from '../feature/types'
import { createTable } from '../table/create-table'
import { defineOptions, isOptionsDefinition } from './options'
import { suggest } from './suggest'
import { tableOptions } from './table-options'

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

/** Creates a table from untyped options (what a JS caller can pass). */
const make = (opts: Record<string, unknown>) =>
  createTable({ data: [], onDiagnostic, ...opts } as never) as ReturnType<typeof createTable>

/** The DatakableConfigError `fn` throws. */
const configError = (fn: () => unknown): DatakableConfigError => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(DatakableConfigError)
    return e as DatakableConfigError
  }
  throw new Error('expected a DatakableConfigError')
}

const pagingOptions = {
  pageSize: {
    type: 'number',
    check: (v: number) => Number.isInteger(v) && v > 0,
    expected: 'a positive integer',
  },
  pageIndex: { type: 'number' },
  mode: { type: 'string', oneOf: ['client', 'server'] },
  rowCount: {
    type: 'number',
    noEffect: (_v: unknown, o: Record<string, unknown>) =>
      o.mode === 'server' ? undefined : "rowCount is only read in mode: 'server'",
  },
} as const

const paging = (values: Record<string, unknown> = {}) =>
  defineFeature({
    name: 'paging',
    stage: 'paginate',
    options: defineOptions(pagingOptions, values),
    initialState: () => ({ page: 0 }),
    createApi: () => ({}),
  }) as AnyFeature

describe('suggest (did-you-mean)', () => {
  it('finds close names, case-insensitive, best first', () => {
    expect(suggest('colums', ['columns', 'data', 'name'])).toEqual(['columns'])
    expect(suggest('TimeOut', ['timeout', 'strict'])).toEqual(['timeout'])
    expect(suggest('dat', ['data', 'date', 'name'])).toEqual(['data', 'date'])
    expect(suggest('ful', ['safe', 'keys', 'full'])).toEqual(['full'])
  })

  it('suggests nothing for unrelated or very long names', () => {
    expect(suggest('banana', ['columns', 'data'])).toEqual([])
    expect(suggest('x'.repeat(40), ['x'.repeat(41)])).toEqual([])
  })
})

describe('defineOptions', () => {
  it('returns the schema and the given values', () => {
    const d = defineOptions(pagingOptions, { pageSize: 10 })
    expect(d.schema).toBe(pagingOptions)
    expect(d.values).toEqual({ pageSize: 10 })
    expect(isOptionsDefinition(d)).toBe(true)
    expect(isOptionsDefinition({ pageSize: 10 })).toBe(false)
  })

  it('the table schema covers every TableOptions key', () => {
    expect(Object.keys(tableOptions.schema).sort()).toEqual(
      [
        'columns',
        'data',
        'diagnostics',
        'features',
        'fetcher',
        'initialData',
        'initialState',
        'interceptors',
        'invalidRows',
        'name',
        'onDiagnostic',
        'onStateChange',
        'rowCount',
        'rowKey',
        'schema',
        'state',
        'strict',
        'timeout',
      ].sort(),
    )
  })
})

describe('DK_UNKNOWN_OPTION', () => {
  it('warns for an unknown table option with a did-you-mean', () => {
    make({ colums: [] })
    const d = only('DK_UNKNOWN_OPTION')
    expect(d.level).toBe('warn')
    expect(d.where).toEqual({ kind: 'option', path: 'colums' })
    expect(d.details).toMatchObject({ path: 'colums', suggestions: ['columns'] })
    expect(d.problem).toContain('"colums"')
    expect(d.fix[0]).toContain('columns')
  })

  it('warns for an unknown nested option', () => {
    make({ diagnostics: { redcat: 'safe' } })
    const d = only('DK_UNKNOWN_OPTION')
    expect(d.where).toEqual({ kind: 'option', path: 'diagnostics.redcat' })
    expect(d.details).toMatchObject({ suggestions: ['redact'] })
  })

  it('points a feature option passed to the table at the feature', () => {
    make({ pageSize: 20, features: [paging()] })
    const d = only('DK_UNKNOWN_OPTION')
    expect(d.details).toMatchObject({ path: 'pageSize', owner: 'paging' })
    expect(d.fix[0]).toContain('paging({ pageSize: ... })')
  })

  it('warns for an unknown option of a feature (where = the feature)', () => {
    make({ features: [paging({ pageSzie: 5 })] })
    const d = only('DK_UNKNOWN_OPTION')
    expect(d.where).toEqual({ kind: 'feature', name: 'paging' })
    expect(d.details).toMatchObject({
      feature: 'paging',
      path: 'pageSzie',
      suggestions: ['pageSize'],
    })
    expect(d.fix[0]).toContain('pageSize')
  })

  it('without a close name the fix lists the accepted options', () => {
    make({ banana: 1 })
    const d = only('DK_UNKNOWN_OPTION')
    expect(d.details).toMatchObject({ suggestions: [] })
    expect(d.fix.join(' ')).toContain('columns')
  })

  it('warns on setOptions too, and keeps the key out of nothing else', () => {
    const t = make({})
    t.setOptions({ colums: [] } as never)
    expect(codes()).toEqual(['DK_UNKNOWN_OPTION'])
    expect(seen[0]?.context.trigger).toBe('setOptions')
  })

  it('accepts every known option without a diagnostic', () => {
    make({
      name: 'users',
      columns: [],
      rowKey: 'id',
      features: [paging({ pageSize: 10, mode: 'server', rowCount: 3 })],
      initialState: {},
      state: {},
      onStateChange: () => {},
      interceptors: [],
      timeout: Number.POSITIVE_INFINITY,
      strict: false,
      diagnostics: { redact: 'keys' },
    })
    expect(codes()).toEqual([])
  })
})

describe('DK_INVALID_OPTION', () => {
  it.each([0, -5, Number.NaN])('rejects timeout %s (only Infinity disables the timer)', (v) => {
    const e = configError(() => make({ timeout: v }))
    expect(e.code).toBe('DK_INVALID_OPTION')
    expect(e.where).toEqual({ kind: 'option', path: 'timeout' })
    expect(e.fix[0]).toContain('Infinity')
  })

  it('accepts a positive timeout or Infinity', () => {
    make({ timeout: 5 })
    make({ timeout: Number.POSITIVE_INFINITY })
    expect(codes()).toEqual([])
  })

  it('rejects an unknown redaction level and suggests the close one', () => {
    const e = configError(() => make({ diagnostics: { redact: 'ful' } }))
    expect(e.code).toBe('DK_INVALID_OPTION')
    expect(e.where).toEqual({ kind: 'option', path: 'diagnostics.redact' })
    expect(e.diagnostic.details).toMatchObject({ received: '"ful"', suggestions: ['full'] })
    expect(e.fix[0]).toContain("'full'")
    expect(e.problem).toContain("'safe' | 'keys' | 'full'")
  })

  it('accepts a custom redact function', () => {
    make({ diagnostics: { redact: () => undefined } })
    expect(codes()).toEqual([])
  })

  it('rejects wrong runtime types and names the accepted type', () => {
    expect(configError(() => make({ strict: 'yes' })).problem).toContain('a boolean')
    expect(configError(() => make({ data: {} })).problem).toContain('an array')
    expect(configError(() => make({ rowKey: 1 })).problem).toContain('a string or a function')
    expect(configError(() => make({ diagnostics: null })).where).toEqual({
      kind: 'option',
      path: 'diagnostics',
    })
  })

  it('rejects a feature list entry that is not a feature', () => {
    const notCalled = configError(() => make({ features: [paging] }))
    expect(notCalled.where).toEqual({ kind: 'option', path: 'features[0]' })
    expect(notCalled.fix[0]).toContain('call the factory')
    const e = configError(() =>
      make({ features: [paging(), { ...paging(), name: 'x', stage: 'sorter' }] }),
    )
    expect(e.where).toEqual({ kind: 'option', path: 'features[1].stage' })
    expect(e.fix[0]).toContain("'sort'")
    expect(
      configError(() => make({ features: [{ ...paging(), createApi: undefined }] })).where,
    ).toEqual({ kind: 'option', path: 'features[0].createApi' })
    expect(configError(() => make({ features: [{ ...paging(), name: '' }] })).where).toEqual({
      kind: 'option',
      path: 'features[0].name',
    })
    expect(
      configError(() => make({ features: [{ ...paging(), options: { pageSize: 1 } }] })).fix[0],
    ).toContain('defineOptions')
  })

  it('rejects an invalid feature option (where = the feature)', () => {
    const e = configError(() => make({ features: [paging({ pageSize: 0 })] }))
    expect(e.where).toEqual({ kind: 'feature', name: 'paging' })
    expect(e.diagnostic.details).toMatchObject({ feature: 'paging', path: 'pageSize' })
    expect(e.problem).toContain('paging({ pageSize })')
    expect(e.problem).toContain('a positive integer')
    const m = configError(() => make({ features: [paging({ mode: 'sever' })] }))
    expect(m.diagnostic.details).toMatchObject({ suggestions: ['server'] })
  })

  it('setOptions with an invalid value throws and keeps the previous options', () => {
    const t = make({ data: [1] })
    const before = t.getOptions()
    const e = configError(() => t.setOptions({ data: 'nope' } as never))
    expect(e.code).toBe('DK_INVALID_OPTION')
    expect(e.diagnostic.context.trigger).toBe('setOptions')
    expect(t.getOptions()).toBe(before)
    expect(t.getData()).toEqual([1])
  })
})

describe('DK_OPTION_NO_EFFECT', () => {
  it.each([
    ['timeout', 1000],
    ['strict', true],
    ['name', 'other'],
    ['initialState', { a: 1 }],
    ['diagnostics', { redact: 'full' }],
  ])('setOptions({ %s }) is read once at creation: warns, keeps the old value', (key, value) => {
    const t = make({ timeout: 5000, strict: false, name: 't', diagnostics: { redact: 'safe' } })
    const before = (t.getOptions() as Record<string, unknown>)[key]
    t.setOptions({ [key]: value } as never)
    const d = only('DK_OPTION_NO_EFFECT')
    expect(d.where).toEqual({ kind: 'option', path: key })
    expect(d.problem).toContain(`setOptions({ ${key} })`)
    expect(d.fix[0]).toContain('createTable')
    expect((t.getOptions() as Record<string, unknown>)[key]).toEqual(before)
  })

  it('setOptions({ features }) warns (features are read once)', () => {
    const t = make({ features: [paging()] })
    t.setOptions({ features: [] } as never)
    const d = only('DK_OPTION_NO_EFFECT')
    expect(d.where).toEqual({ kind: 'option', path: 'features' })
  })

  it('does not warn when a read-once option is passed again unchanged', () => {
    const redact = { redact: 'safe' }
    const t = make({ timeout: 5000, diagnostics: redact })
    t.setOptions({ timeout: 5000, diagnostics: { redact: 'safe' } } as never)
    expect(codes()).toEqual([])
  })

  it('runs a feature noEffect rule with the reason', () => {
    make({ features: [paging({ rowCount: 50 })] })
    const d = only('DK_OPTION_NO_EFFECT')
    expect(d.where).toEqual({ kind: 'feature', name: 'paging' })
    expect(d.details).toMatchObject({ path: 'rowCount', feature: 'paging' })
    expect(d.problem).toContain("only read in mode: 'server'")
  })

  it('every emitted code has a non-empty where and fix', () => {
    make({ colums: [], features: [paging({ rowCount: 1 })] }).setOptions({ timeout: 1 } as never)
    expect(codes().sort()).toEqual([
      'DK_OPTION_NO_EFFECT',
      'DK_OPTION_NO_EFFECT',
      'DK_UNKNOWN_OPTION',
    ])
    for (const d of seen) {
      expect(d.fix.length).toBeGreaterThan(0)
      expect(d.impact).not.toBe('')
    }
  })
})
