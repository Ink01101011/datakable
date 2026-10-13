import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatakableConfigError } from '../diagnostics/build'
import { getDiagnosticDefinition } from '../diagnostics/catalog'
import type { Diagnostic } from '../diagnostics/types'
import { defineFeature } from '../feature/define'
import type { AnyFeature } from '../feature/types'
import { createTable } from '../table/create-table'
import { VERSION } from '../version'
import { detectCapability } from './capability'
import { defineDeprecation, warnDeprecated } from './deprecation'
import { REGISTRY_KEY, registerPackage } from './registry'

type Core = typeof import('../index')

const KEY = Symbol.for('datakable')
const g = globalThis as Record<symbol, unknown>

let seen: Diagnostic[]
const onDiagnostic = (d: Diagnostic) => {
  seen.push(d)
}
const codes = () => seen.map((d) => d.code)
const of = (code: string) => seen.filter((d) => d.code === code)

/** A separate copy of core in this process: a fresh module graph, like a second install. */
async function loadCore(): Promise<Core> {
  vi.resetModules()
  return import('../index')
}

beforeEach(() => {
  seen = []
  delete g[KEY]
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  delete g[KEY]
})

describe('global registry', () => {
  it('lives on globalThis[Symbol.for("datakable")]', () => {
    expect(REGISTRY_KEY).toBe(KEY)
    createTable({ data: [], onDiagnostic })
    const reg = g[KEY] as { cores: { version: string }[] }
    expect(reg.cores.map((c) => c.version)).toEqual([VERSION])
  })

  it('two core copies in one process → DK_DUPLICATE_CORE on the second copy', async () => {
    const a = await loadCore()
    const b = await loadCore()
    expect(a.createTable).not.toBe(b.createTable)
    a.createTable({ data: [], onDiagnostic })
    expect(codes()).not.toContain('DK_DUPLICATE_CORE')
    b.createTable({ data: [], onDiagnostic })
    const [d] = of('DK_DUPLICATE_CORE')
    expect(d?.level).toBe('error')
    expect(d?.details).toEqual({ versions: [VERSION, VERSION] })
    expect(d?.where).toEqual({ kind: 'operation', op: 'createTable' })
    expect(d?.fix.join('\n')).toContain('pnpm why @datakable/core')
    expect(d?.fix.join('\n')).toContain('overrides')
    // Once per copy: more tables from either copy stay quiet.
    b.createTable({ data: [], onDiagnostic })
    a.createTable({ data: [], onDiagnostic })
    expect(of('DK_DUPLICATE_CORE')).toHaveLength(1)
  })

  it('the same copy creating many tables is not a duplicate', () => {
    createTable({ data: [], onDiagnostic })
    createTable({ data: [], onDiagnostic })
    expect(codes()).not.toContain('DK_DUPLICATE_CORE')
  })

  it('DK_DUPLICATE_CORE does not throw (the table still works) unless strict', async () => {
    const a = await loadCore()
    const b = await loadCore()
    a.createTable({ data: [] })
    expect(() => b.createTable({ data: [1], onDiagnostic })).not.toThrow()
    const c = await loadCore()
    expect(() => c.createTable({ data: [], strict: true })).toThrow(/DK_DUPLICATE_CORE/)
  })

  it('a malformed registry left by someone else never throws', () => {
    g[KEY] = { cores: 'nope', packages: 7 }
    expect(() => createTable({ data: [], onDiagnostic })).not.toThrow()
    g[KEY] = 42
    expect(() => createTable({ data: [], onDiagnostic })).not.toThrow()
  })
})

describe('DK_VERSION_MISMATCH', () => {
  it('reports each fixed-group package whose version differs from core, once', () => {
    registerPackage('@datakable/react', '9.9.9')
    registerPackage('datakable', VERSION)
    createTable({ data: [], onDiagnostic })
    createTable({ data: [], onDiagnostic })
    const ds = of('DK_VERSION_MISMATCH')
    expect(ds).toHaveLength(1)
    const d = ds[0] as Diagnostic
    expect(d.level).toBe('warn')
    expect(d.details).toEqual({ package: '@datakable/react', version: '9.9.9', core: VERSION })
    expect(d.where).toEqual({ kind: 'operation', op: 'createTable' })
    expect(d.fix[0]).toContain(`@datakable/core@9.9.9 @datakable/react@9.9.9 datakable@9.9.9`)
  })

  it('a package registered after the first table is reported by the next one', () => {
    createTable({ data: [], onDiagnostic })
    expect(codes()).not.toContain('DK_VERSION_MISMATCH')
    registerPackage('datakable', '9.0.0')
    createTable({ data: [], onDiagnostic })
    expect(of('DK_VERSION_MISMATCH')).toHaveLength(1)
  })

  it('matching versions are silent', () => {
    registerPackage('@datakable/react', VERSION)
    createTable({ data: [], onDiagnostic })
    expect(codes()).not.toContain('DK_VERSION_MISMATCH')
  })
})

describe('DK_FEATURE_INCOMPATIBLE (feature requires)', () => {
  const feature = (requires?: { core: string }) =>
    defineFeature({
      name: 'needsCore',
      stage: 'none',
      initialState: () => ({}),
      createApi: () => ({ needsCoreApi: () => 1 }),
      ...(requires ? { requires } : {}),
    }) as AnyFeature

  it('a met range installs the feature', () => {
    const t = createTable({ data: [], features: [feature({ core: `^${VERSION}` })] })
    expect(typeof (t as unknown as Record<string, unknown>).needsCoreApi).toBe('function')
    expect(() => createTable({ data: [], features: [feature({ core: '*' })] })).not.toThrow()
    expect(() => createTable({ data: [], features: [feature()] })).not.toThrow()
  })

  it('an unmet range throws DatakableConfigError at creation', () => {
    let err: unknown
    try {
      createTable({ data: [], features: [feature({ core: '>=99.0.0' })] })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(DatakableConfigError)
    const e = err as DatakableConfigError
    expect(e.code).toBe('DK_FEATURE_INCOMPATIBLE')
    expect(e.where).toEqual({ kind: 'feature', name: 'needsCore' })
    expect(e.diagnostic.details).toEqual({
      feature: 'needsCore',
      required: '>=99.0.0',
      core: VERSION,
      invalid: false,
    })
    expect(e.problem).toContain('>=99.0.0')
    expect(e.problem).toContain(VERSION)
    expect(e.fix[0]).toContain('pnpm add @datakable/core@">=99.0.0"')
  })

  it('an unparseable range is the same config error, with a range fix', () => {
    let err: unknown
    try {
      createTable({ data: [], features: [feature({ core: 'latest' })] })
    } catch (e) {
      err = e
    }
    const e = err as DatakableConfigError
    expect(e.code).toBe('DK_FEATURE_INCOMPATIBLE')
    expect(e.diagnostic.details).toMatchObject({ invalid: true })
    expect(e.fix[0]).toContain("'^1.0'")
  })
})

describe('defineDeprecation / DK_DEPRECATED', () => {
  it('warns once per API per session with since, removeIn, replacement and codemod', () => {
    const dep = defineDeprecation({
      api: 'table.setGlobalFilter',
      since: '1.2.0',
      removeIn: '2.0.0',
      replacement: 'table.setSearch(query)',
      codemod: 'npx @datakable/codemod global-filter-to-search',
    })
    const emit = vi.fn()
    warnDeprecated(dep, emit)
    warnDeprecated(dep, emit)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('DK_DEPRECATED', {
      api: 'table.setGlobalFilter',
      since: '1.2.0',
      removeIn: '2.0.0',
      replacement: 'table.setSearch(query)',
      codemod: 'npx @datakable/codemod global-filter-to-search',
    })
  })

  it('once per session is shared by every core copy (global registry)', async () => {
    const a = await loadCore()
    const b = await loadCore()
    const def = { api: 'options.oldThing', since: '1.1.0', removeIn: '2.0.0', replacement: 'x' }
    const emit = vi.fn()
    a.warnDeprecated(a.defineDeprecation(def), emit)
    b.warnDeprecated(b.defineDeprecation(def), emit)
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('builds a full diagnostic with an option or method location', () => {
    const dep = defineDeprecation({
      api: 'options.globalFilter',
      since: '1.3.0',
      removeIn: '2.0.0',
      replacement: "search: { query: '' }",
    })
    warnDeprecated(dep)
    // No emit given: the table-less hub reports it to the console.
    expect(console.warn).toHaveBeenCalled()
    const def = getDiagnosticDefinition('DK_DEPRECATED')
    expect(def?.level).toBe('warn')
    const details = {
      api: 'options.globalFilter',
      since: '1.3.0',
      removeIn: '2.0.0',
      replacement: 'y',
    }
    expect(def?.where(details as never)).toEqual({ kind: 'option', path: 'globalFilter' })
    expect(def?.where({ ...details, api: 'table.foo' } as never)).toEqual({
      kind: 'operation',
      op: 'table.foo',
    })
    expect(def?.fix(details as never)[0]).toContain('y')
    expect(def?.problem(details as never)).toContain('1.3.0')
    expect(def?.impact(details as never)).toContain('2.0.0')
  })

  it('rejects a definition without since / removeIn / replacement', () => {
    expect(() =>
      defineDeprecation({ api: 'x', since: '', removeIn: '2.0.0', replacement: 'y' }),
    ).toThrow(/since/)
  })
})

describe('detectCapability / DK_DEP_INCOMPATIBLE', () => {
  const info = {
    feature: 'sorting',
    dependency: 'exsorted',
    capability: 'timSort',
    supported: '^1.2.3',
    fallback: 'Array.prototype.sort (stable, native)',
  }

  it('a present capability is silent and true', () => {
    const emit = vi.fn()
    expect(detectCapability(() => true, info, emit)).toBe(true)
    expect(emit).not.toHaveBeenCalled()
  })

  it('a missing or throwing probe is false, reported once per capability', () => {
    const emit = vi.fn()
    expect(detectCapability(() => false, info, emit)).toBe(false)
    expect(
      detectCapability(
        () => {
          throw new Error('x')
        },
        info,
        emit,
      ),
    ).toBe(false)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('DK_DEP_INCOMPATIBLE', info)
  })

  it('catalog entry: feature location, supported range and fallback in the text', () => {
    const def = getDiagnosticDefinition('DK_DEP_INCOMPATIBLE')
    expect(def?.level).toBe('warn')
    expect(def?.where(info as never)).toEqual({ kind: 'feature', name: 'sorting' })
    expect(def?.impact(info as never)).toContain('Array.prototype.sort')
    expect(def?.fix(info as never).join('\n')).toContain('exsorted@"^1.2.3"')
  })
})

describe('catalog', () => {
  it.each([
    'DK_DEPRECATED',
    'DK_DUPLICATE_CORE',
    'DK_VERSION_MISMATCH',
    'DK_DEP_INCOMPATIBLE',
    'DK_FEATURE_INCOMPATIBLE',
  ])('%s is defined', (code) => {
    expect(getDiagnosticDefinition(code)).toBeDefined()
  })

  it('DK_FEATURE_INCOMPATIBLE is a config error', () => {
    expect(getDiagnosticDefinition('DK_FEATURE_INCOMPATIBLE')?.config).toBe(true)
  })
})
