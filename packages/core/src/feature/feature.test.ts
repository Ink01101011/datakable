import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DatakableConfigError, DatakableError } from '../diagnostics/build'
import type { Diagnostic } from '../diagnostics/types'
import { defineInterceptor } from '../intercept/define'
import { createTable } from '../table/create-table'
import { getTableInternals } from '../table/internals'
import { defineFeature } from './define'
import { orderFeatures, STAGES } from './order'
import type { AnyFeature, Stage } from './types'

let seen: Diagnostic[]
const onDiagnostic = (d: Diagnostic) => {
  seen.push(d)
}
const codes = () => seen.map((d) => d.code)

beforeEach(() => {
  seen = []
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

/** A minimal feature: slice `{ n }`, API `inc<Name>()` / `get<Name>()`. */
const counter = (name: string, stage: Stage = 'none', extra: Partial<AnyFeature> = {}) => {
  const f = defineFeature({
    name,
    stage,
    initialState: () => ({ n: 0 }),
    createApi: (ctx) => ({
      [`inc${name}`]: () => ctx.setState((s) => ({ n: s.n + 1 })),
      [`get${name}`]: () => ctx.getState().n,
    }),
  })
  return { ...f, ...extra } as AnyFeature
}

const api = (t: object) => t as Record<string, (...a: unknown[]) => unknown>

describe('stage ordering', () => {
  it('pipeline order is filter → search → sort → paginate, none last', () => {
    expect(STAGES).toEqual(['filter', 'search', 'sort', 'paginate', 'none'])
  })

  it('orders features by stage, stable within a stage', () => {
    const fs = [
      counter('page', 'paginate'),
      counter('sel', 'none'),
      counter('sort', 'sort'),
      counter('search', 'search'),
      counter('columnFilters', 'filter'),
      counter('validity', 'filter'),
    ]
    expect(orderFeatures(fs, 't').map((f) => f.name)).toEqual([
      'columnFilters',
      'validity',
      'search',
      'sort',
      'page',
      'sel',
    ])
    // the input is not mutated
    expect(fs[0]?.name).toBe('page')
  })

  it('the table exposes the ordered features to the pipeline (internals seam)', () => {
    const t = createTable({ data: [], features: [counter('b', 'sort'), counter('a', 'filter')] })
    expect(getTableInternals(t).features.map((f) => f.name)).toEqual(['a', 'b'])
  })
})

describe('DK_FEATURE_DUPLICATE', () => {
  it('throws DatakableConfigError at creation, naming the feature and both positions', () => {
    let err: unknown
    try {
      createTable({
        name: 'Users',
        data: [],
        features: [counter('a'), counter('sorting', 'sort'), counter('sorting', 'sort')],
        onDiagnostic,
      })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(DatakableConfigError)
    const e = err as DatakableConfigError
    expect(e.code).toBe('DK_FEATURE_DUPLICATE')
    expect(e.where).toEqual({ kind: 'feature', name: 'sorting' })
    expect(e.problem).toContain('features[1]')
    expect(e.problem).toContain('features[2]')
    expect(e.fix.length).toBeGreaterThan(0)
    expect(e.diagnostic.context.table).toBe('Users')
  })
})

describe('DK_FEATURE_API_CONFLICT', () => {
  const shared = (name: string) =>
    defineFeature({
      name,
      stage: 'none',
      initialState: () => null,
      createApi: () => ({ reset: () => {} }),
    })

  it('two features exposing the same method: names both, suggests a namespace', () => {
    let err: unknown
    try {
      createTable({ data: [], features: [shared('sorting'), shared('filters')] })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(DatakableConfigError)
    const e = err as DatakableConfigError
    expect(e.code).toBe('DK_FEATURE_API_CONFLICT')
    expect(e.where).toEqual({ kind: 'feature', name: 'filters' })
    expect(e.problem).toContain('"reset"')
    expect(e.problem).toContain('"sorting"')
    expect(e.problem).toContain('"filters"')
    expect(e.fix.join('\n')).toMatch(/filtersReset|filters\.reset/)
  })

  it('a feature method that shadows a core table method conflicts too', () => {
    const bad = defineFeature({
      name: 'bad',
      stage: 'none',
      initialState: () => 0,
      createApi: () => ({ getState: () => 1 }),
    })
    expect(() => createTable({ data: [], features: [bad] })).toThrow(/DK_FEATURE_API_CONFLICT/)
    try {
      createTable({ data: [], features: [bad] })
    } catch (e) {
      expect((e as DatakableConfigError).problem).toContain('the table')
    }
  })

  it('reports conflicts in the order features were listed (not pipeline order)', () => {
    const a = { ...shared('pager'), stage: 'paginate' as const }
    const b = { ...shared('filt'), stage: 'filter' as const }
    try {
      createTable({ data: [], features: [a, b] })
      expect.unreachable()
    } catch (e) {
      expect((e as DatakableConfigError).where).toEqual({ kind: 'feature', name: 'filt' })
    }
  })
})

describe('createTable with features', () => {
  it('initial state: each slice from initialState(), options.initialState wins per slice', () => {
    const t = createTable({
      data: [],
      features: [counter('a'), counter('b')],
      initialState: { b: { n: 5 }, other: 1 } as never,
    })
    expect(t.getState()).toEqual({ a: { n: 0 }, b: { n: 5 }, other: 1 })
  })

  it('initialState() runs per table (fresh objects)', () => {
    const f = counter('a')
    const t1 = createTable({ data: [], features: [f] })
    const t2 = createTable({ data: [], features: [f] })
    expect(t1.getState().a).not.toBe(t2.getState().a)
  })

  it('merges feature APIs onto the table; they update the own slice and notify once', () => {
    const t = createTable({ data: [], features: [counter('a'), counter('b')] })
    const listener = vi.fn()
    t.subscribe(listener)
    api(t).inca?.()
    api(t).inca?.()
    expect(api(t).geta?.()).toBe(2)
    expect(t.getState()).toEqual({ a: { n: 2 }, b: { n: 0 } })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('updates made inside one API call are notified once, after the call returns', () => {
    const twice = defineFeature({
      name: 'x',
      stage: 'none',
      initialState: () => 0,
      createApi: (ctx) => ({
        bumpTwice: () => {
          ctx.setState((n) => n + 1)
          ctx.setState((n) => n + 1)
          return 'done'
        },
      }),
    })
    const t = createTable({ data: [], features: [twice] })
    const listener = vi.fn()
    t.subscribe(listener)
    expect(t.bumpTwice()).toBe('done')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0]?.[0]).toEqual({ x: 2 })
  })

  it('feature API calls run with trigger api:<method> and where = feature name', () => {
    const triggers: string[] = []
    const t = createTable({
      data: [],
      features: [counter('a')],
      interceptors: [
        defineInterceptor({
          name: 'spy',
          on: ['state:dispatch'],
          intercept: (ctx, next) => {
            triggers.push(`${ctx.trigger}@${ctx.where}`)
            return next()
          },
        }),
      ],
    })
    api(t).inca?.()
    t.setState({ a: { n: 9 } })
    expect(triggers).toEqual(['api:inca@a', 'api:setState@setState'])
  })

  it('controlled feature slices go through onStateChange', () => {
    const onStateChange = vi.fn()
    const t = createTable({
      data: [],
      features: [counter('a')],
      state: { a: { n: 7 } } as never,
      onStateChange,
    })
    expect(t.getState()).toEqual({ a: { n: 7 } })
    api(t).inca?.()
    expect(onStateChange).toHaveBeenCalledTimes(1)
    const updater = onStateChange.mock.calls[0]?.[0] as (p: object) => object
    expect(updater({})).toEqual({ a: { n: 8 } })
    expect(t.getState()).toEqual({ a: { n: 7 } })
  })

  it('after destroy(), feature API calls are no-ops reporting DK_TABLE_DESTROYED', () => {
    const t = createTable({ data: [], features: [counter('a')], onDiagnostic })
    t.destroy()
    expect(api(t).inca?.()).toBeUndefined()
    expect(t.getState()).toEqual({ a: { n: 0 } })
    expect(codes()).toEqual(['DK_TABLE_DESTROYED'])
    expect(seen[0]?.details).toEqual({ method: 'inca' })
  })

  it('after destroy(), a method listed in destroyedResult returns that value (still a no-op)', () => {
    const f = { ...counter('a'), destroyedResult: { geta: () => -1 } } as AnyFeature
    const t = createTable({ data: [], features: [f], onDiagnostic })
    expect(api(t).geta?.()).toBe(0)
    t.destroy()
    expect(api(t).geta?.()).toBe(-1)
    expect(api(t).inca?.()).toBeUndefined()
    expect(t.getState()).toEqual({ a: { n: 0 } })
    expect(codes()).toEqual(['DK_TABLE_DESTROYED', 'DK_TABLE_DESTROYED'])
  })

  it('ctx gives the feature its name, the table and the hub emitter', () => {
    let captured: { name: string; table: unknown } | undefined
    const f = defineFeature({
      name: 'probe',
      stage: 'none',
      initialState: () => 1,
      createApi: (ctx) => {
        captured = { name: ctx.name, table: ctx.table }
        ctx.emit('DK_TABLE_DESTROYED', { method: 'probe' })
        return {}
      },
    })
    const t = createTable({ data: [], features: [f], onDiagnostic })
    expect(captured).toEqual({ name: 'probe', table: t })
    expect(codes()).toEqual(['DK_TABLE_DESTROYED'])
  })

  it('non-function API members are copied as-is', () => {
    const f = defineFeature({
      name: 'meta',
      stage: 'none',
      initialState: () => 0,
      createApi: () => ({ metaVersion: 3 }),
    })
    expect(createTable({ data: [], features: [f] }).metaVersion).toBe(3)
  })

  it('feature interceptors run after asyncControl and before the user interceptors', () => {
    const order: string[] = []
    const spy = (name: string) =>
      defineInterceptor({
        name,
        on: ['state:dispatch'],
        intercept: (_ctx, next) => {
          order.push(name)
          return next()
        },
      })
    const t = createTable({
      data: [],
      features: [counter('a', 'none', { interceptors: [spy('feature')] })],
      interceptors: [spy('user')],
    })
    t.setState({ a: { n: 1 } })
    expect(order).toEqual(['feature', 'user'])
    // replacing the user interceptors keeps the feature's
    order.length = 0
    t.setOptions({ interceptors: [spy('user2')] })
    t.setState({ a: { n: 2 } })
    expect(order).toEqual(['feature', 'user2'])
  })

  it('features are read once: setOptions({ features }) does not reinstall them', () => {
    const t = createTable({ data: [], features: [counter('a')] })
    t.setOptions({ features: [counter('z')] } as never)
    expect(api(t).incz).toBeUndefined()
    expect(getTableInternals(t).features.map((f) => f.name)).toEqual(['a'])
  })
})

describe('DK_FEATURE_FAILED', () => {
  const boom = () => {
    throw new TypeError('boom')
  }

  it('initialState() throws: reported, slice undefined, table still created', () => {
    const f = defineFeature({
      name: 'bad',
      stage: 'none',
      initialState: boom,
      createApi: () => ({}),
    })
    const t = createTable({ data: [], features: [f, counter('ok')], onDiagnostic })
    expect(t.getState()).toEqual({ bad: undefined, ok: { n: 0 } })
    expect(codes()).toEqual(['DK_FEATURE_FAILED'])
    expect(seen[0]?.where).toEqual({ kind: 'feature', name: 'bad' })
    expect(seen[0]?.details).toMatchObject({
      feature: 'bad',
      hook: 'initialState',
      errorName: 'TypeError',
    })
    expect(seen[0]?.context.cause).toBeInstanceOf(TypeError)
  })

  it('initialState() is not called for a slice given in options.initialState', () => {
    const init = vi.fn(() => 0)
    createTable({
      data: [],
      features: [
        defineFeature({ name: 'x', stage: 'none', initialState: init, createApi: () => ({}) }),
      ],
      initialState: { x: 1 } as never,
    })
    expect(init).not.toHaveBeenCalled()
  })

  it('createApi() throws: reported; other features still install', () => {
    const f = defineFeature({ name: 'bad', stage: 'none', initialState: () => 0, createApi: boom })
    const t = createTable({ data: [], features: [f, counter('ok')], onDiagnostic })
    expect(codes()).toEqual(['DK_FEATURE_FAILED'])
    expect(seen[0]?.details).toMatchObject({ feature: 'bad', hook: 'createApi' })
    expect(seen[0]?.fix.length).toBeGreaterThan(0)
    expect(api(t).incok?.()).toBeUndefined()
    expect(t.getState()).toMatchObject({ ok: { n: 1 } })
  })

  it('strict: true turns it into a thrown DatakableError', () => {
    const f = defineFeature({ name: 'bad', stage: 'none', initialState: () => 0, createApi: boom })
    expect(() => createTable({ data: [], features: [f], strict: true })).toThrow(DatakableError)
  })
})

describe('ctx.where never carries row data for feature slices (extends the T07 property)', () => {
  const SENTINEL = 'SECRET-123'
  const PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/

  it('feature API calls and feature setState use constant wheres', () => {
    const wheres: string[] = []
    const f = defineFeature({
      name: 'query',
      stage: 'search',
      initialState: () => SENTINEL,
      createApi: (ctx) => ({ setQuery: (q: string) => ctx.setState(q) }),
    })
    const t = createTable({
      name: 'T',
      data: [{ id: SENTINEL }],
      features: [f, counter('a')],
      state: { a: { n: 1 } } as never,
      onStateChange: () => {},
      onDiagnostic,
      interceptors: [
        defineInterceptor({
          name: 'where-spy',
          on: '*',
          hot: true,
          intercept: (ctx, next) => {
            // diagnostic:emit carries the formatted Location; checked by the JSON assertion below.
            if (ctx.op !== 'diagnostic:emit') wheres.push(ctx.where)
            return next()
          },
        }),
      ],
    })
    t.subscribe(() => {})
    t.setQuery(`${SENTINEL}!`)
    api(t).inca?.()
    t.setState({ query: `${SENTINEL}?` })
    t.destroy()
    t.setQuery(SENTINEL)
    expect(wheres.length).toBeGreaterThan(4)
    for (const w of wheres) {
      expect(w).not.toContain(SENTINEL)
      expect(w).toMatch(PATH)
    }
    for (const d of seen) expect(JSON.stringify(d)).not.toContain(SENTINEL)
  })
})
