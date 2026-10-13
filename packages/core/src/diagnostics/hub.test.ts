import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineInterceptor } from '../intercept/define'
import { createInterceptorRuntime } from '../intercept/runtime'
import { VERSION } from '../version'
import { DatakableError } from './build'
import { defineDiagnostic } from './catalog'
import { createDiagnostics, type DiagnosticsOptions } from './hub'

declare module './catalog' {
  interface DiagnosticCatalog {
    DK_TEST_ROW: { index: number; key: bigint; payload?: unknown }
    DK_TEST_INFO: { name: string }
  }
}

defineDiagnostic({
  code: 'DK_TEST_ROW',
  level: 'error',
  where: (d) => ({ kind: 'row', index: d.index, key: String(d.key) }),
  problem: (d) => `row #${d.index} is broken`,
  impact: () => 'the row is dropped',
  fix: (d) => [`fix row ${d.key}`, 'or remove it'],
})
defineDiagnostic({
  code: 'DK_TEST_INFO',
  level: 'info',
  where: (d) => ({ kind: 'feature', name: d.name }),
  problem: (d) => `${d.name} chose a strategy`,
  impact: () => 'none',
  fix: () => ['nothing to do'],
})

const quiet = (o: DiagnosticsOptions = {}) => createDiagnostics({ console: false, ...o })

let now = 1000
beforeEach(() => {
  now = 1000
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('createDiagnostics: enrich', () => {
  it('every diagnostic carries context.table, trigger and run', () => {
    const hub = quiet({
      name: 'UsersTable',
      now: () => now,
      getContext: () => ({ trigger: 'data-change', run: 12, phase: 'client' }),
    })
    const d = hub.emit('DK_TEST_ROW', { index: 3, key: 42n })
    expect(d).toBeDefined()
    expect(d?.context.table).toBe('UsersTable')
    expect(d?.context.trigger).toBe('data-change')
    expect(d?.context.run).toBe(12)
    expect(d?.context.phase).toBe('client')
    expect(d?.context.package).toBe(`@datakable/core@${VERSION}`)
    expect(d?.context.occurrences).toEqual({ count: 1, first: 1000, last: 1000 })
    expect(d?.level).toBe('error')
    expect(d?.where).toEqual({ kind: 'row', index: 3, key: '42' })
    expect(d?.problem).toBe('row #3 is broken')
    expect(d?.fix).toEqual(['fix row 42', 'or remove it'])
    expect(d?.fingerprint).toBe('DK_TEST_ROW@row #3 (key 42)')
  })

  it('names unnamed tables table#n and defaults trigger/run/phase', () => {
    const a = quiet()
    const b = quiet()
    expect(a.table).toMatch(/^table#\d+$/)
    expect(b.table).not.toBe(a.table)
    const d = a.emit('DK_TEST_INFO', { name: 'sorting' })
    expect(d?.context.table).toBe(a.table)
    expect(d?.context.trigger).toBe('init')
    expect(d?.context.run).toBe(0)
    expect(['ssr', 'client']).toContain(d?.context.phase)
    expect(d?.context.mode).toEqual({})
    expect(d?.context.state).toEqual({ searchLength: 0, activeFilters: [], sort: [], page: 0 })
  })

  it('per-call options override the live context and carry cause / causedBy', () => {
    const hub = quiet({ getContext: () => ({ run: 4 }) })
    const cause = new Error('root')
    const d = hub.emit('DK_TEST_INFO', { name: 'x' }, { run: 9, cause, causedBy: 'DK_X#run8' })
    expect(d?.context.run).toBe(9)
    expect(d?.context.cause).toBe(cause)
    expect(d?.context.causedBy).toBe('DK_X#run8')
  })

  it('toJSON is bigint- and cycle-safe and leaves out cause', () => {
    const hub = quiet()
    const cyc: Record<string, unknown> = { big: 1n }
    cyc.self = cyc
    const d = hub.emit(
      'DK_TEST_ROW',
      { index: 1, key: 7n, payload: cyc },
      { cause: new Error('t') },
    )
    expect(() => JSON.stringify(d)).not.toThrow()
    const json = JSON.parse(JSON.stringify(d))
    expect(json.details).toEqual({
      index: 1,
      key: '7n',
      payload: { big: '1n', self: '[Circular]' },
    })
    expect(json.code).toBe('DK_TEST_ROW')
    expect(json.context.table).toBe(hub.table)
    expect('cause' in json.context).toBe(false)
    expect(typeof json.toJSON).toBe('undefined')
  })

  it('an unknown code becomes DK_INTERNAL instead of throwing', () => {
    const hub = quiet()
    // @ts-expect-error not in the catalog
    const d = hub.emit('DK_NOPE', {})
    expect(d?.code).toBe('DK_INTERNAL')
    expect(d?.problem).toMatch(/DK_NOPE/)
  })
})

describe('createDiagnostics: dedupe, buffer, sinks', () => {
  it('dedupe aggregates occurrences and reports once', () => {
    const onDiagnostic = vi.fn()
    const hub = quiet({ onDiagnostic, now: () => now })
    const first = hub.emit('DK_TEST_ROW', { index: 1, key: 1n })
    now = 2000
    const again = hub.emit('DK_TEST_ROW', { index: 1, key: 1n })
    now = 3000
    hub.emit('DK_TEST_ROW', { index: 1, key: 1n })
    expect(again).toBe(first)
    expect(onDiagnostic).toHaveBeenCalledTimes(1)
    expect(hub.getDiagnostics()).toHaveLength(1)
    expect(first?.context.occurrences).toEqual({ count: 3, first: 1000, last: 3000 })
    // A different where is a different report.
    hub.emit('DK_TEST_ROW', { index: 2, key: 1n })
    expect(onDiagnostic).toHaveBeenCalledTimes(2)
  })

  it('reports again for a new data reference', () => {
    const onDiagnostic = vi.fn()
    let data: unknown[] = []
    const hub = quiet({ onDiagnostic, getDataRef: () => data })
    hub.emit('DK_TEST_ROW', { index: 1, key: 1n })
    hub.emit('DK_TEST_ROW', { index: 1, key: 1n })
    data = []
    hub.emit('DK_TEST_ROW', { index: 1, key: 1n })
    expect(onDiagnostic).toHaveBeenCalledTimes(2)
  })

  it('ring buffer is bounded at 100, oldest dropped', () => {
    const hub = quiet()
    for (let i = 0; i < 150; i++) hub.emit('DK_TEST_ROW', { index: i, key: 0n })
    const all = hub.getDiagnostics()
    expect(all).toHaveLength(100)
    expect(all[0]?.where).toEqual({ kind: 'row', index: 50, key: '0' })
    expect(all[99]?.where).toEqual({ kind: 'row', index: 149, key: '0' })
    hub.clear()
    expect(hub.getDiagnostics()).toHaveLength(0)
  })

  it('dedupe map is bounded: old entries are forgotten', () => {
    const onDiagnostic = vi.fn()
    const hub = quiet({ onDiagnostic, dedupeLimit: 3 })
    for (let i = 0; i < 4; i++) hub.emit('DK_TEST_ROW', { index: i, key: 0n })
    hub.emit('DK_TEST_ROW', { index: 0, key: 0n }) // evicted → reported again
    hub.emit('DK_TEST_ROW', { index: 3, key: 0n }) // still known → deduped
    expect(onDiagnostic).toHaveBeenCalledTimes(5)
  })

  it('a throwing onDiagnostic is swallowed with one console.error', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hub = quiet({
      onDiagnostic: () => {
        throw new Error('sentry down')
      },
    })
    expect(() => hub.emit('DK_TEST_ROW', { index: 1, key: 1n })).not.toThrow()
    expect(() => hub.emit('DK_TEST_ROW', { index: 2, key: 1n })).not.toThrow()
    expect(error).toHaveBeenCalledTimes(1)
    expect(hub.getDiagnostics()).toHaveLength(2)
    // Development prints the error itself (production: its name only, console-scrub.prod.test.ts).
    expect(error.mock.calls[0]?.[1]).toBeInstanceOf(Error)
  })

  it('strict rethrows error level as DatakableError, not warn/info', () => {
    const hub = quiet({ strict: true })
    expect(() => hub.emit('DK_TEST_INFO', { name: 'x' })).not.toThrow()
    let caught: unknown
    try {
      hub.emit('DK_TEST_ROW', { index: 1, key: 1n })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(DatakableError)
    expect((caught as DatakableError).code).toBe('DK_TEST_ROW')
    expect((caught as DatakableError).diagnostic.context.table).toBe(hub.table)
  })

  it('runs the redact seam before dedupe and sinks', () => {
    const onDiagnostic = vi.fn()
    const hub = quiet({
      onDiagnostic,
      redact: (d) => {
        d.details = { redacted: true }
        return d
      },
    })
    hub.emit('DK_TEST_ROW', { index: 1, key: 1n })
    expect(onDiagnostic.mock.calls[0]?.[0].details).toEqual({ redacted: true })
  })
})

describe('createDiagnostics: console sink', () => {
  it('dev: one collapsed group per diagnostic in the spec format', () => {
    const group = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
    const end = vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hub = createDiagnostics({
      name: 'UsersTable',
      dev: true,
      getContext: () => ({ trigger: 'data-change', run: 12, phase: 'client' }),
    })
    hub.emit('DK_TEST_ROW', { index: 3, key: 42n })
    expect(group).toHaveBeenCalledWith('✖ [DataKable UsersTable] DK_TEST_ROW: row #3 is broken')
    const body = String(error.mock.calls[0]?.[0])
    expect(body).toContain('  where   row #3 (key 42)')
    expect(body).toContain('  impact  the row is dropped')
    expect(body).toContain('  fix     1. fix row 42\n          2. or remove it')
    expect(body).toContain('  docs    ')
    expect(body).toContain('  context trigger=data-change run=12 phase=client')
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('prod: logs error level only, one line, no text builders', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const hub = createDiagnostics({ dev: false })
    const d = hub.emit('DK_TEST_INFO', { name: 'x' })
    expect(d?.problem).toBe('')
    expect(d?.fix).toEqual([])
    expect(d?.docs).toMatch(/\?v=.*#dk_test_info$/)
    hub.emit('DK_TEST_ROW', { index: 1, key: 1n })
    expect(info).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0]?.[0])).toMatch(/DK_TEST_ROW/)
  })

  it('rate-limits the console but not onDiagnostic or the buffer', () => {
    vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onDiagnostic = vi.fn()
    const hub = createDiagnostics({
      dev: true,
      now: () => now,
      onDiagnostic,
      rateLimit: { max: 2, windowMs: 1000 },
    })
    for (let i = 0; i < 5; i++) hub.emit('DK_TEST_ROW', { index: i, key: 0n })
    expect(error).toHaveBeenCalledTimes(2)
    expect(onDiagnostic).toHaveBeenCalledTimes(5)
    expect(hub.getDiagnostics()).toHaveLength(5)
    now = 2500
    hub.emit('DK_TEST_ROW', { index: 9, key: 0n })
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/3 diagnostics were not printed/))
    expect(error).toHaveBeenCalledTimes(3)
  })
})

describe('createDiagnostics: diagnostic:emit chain', () => {
  it('user interceptors on diagnostic:emit see the enriched diagnostic and can redact or drop', () => {
    const onDiagnostic = vi.fn()
    const hub = quiet({ onDiagnostic })
    const rt = createInterceptorRuntime({
      emit: hub.emit,
      interceptors: [
        defineInterceptor({
          name: 'company-redact',
          on: ['diagnostic:emit'],
          intercept(ctx, next) {
            const d = ctx.input.diagnostic
            expect(d.context.table).toBe(hub.table)
            if (d.level === 'info') return undefined // drop
            d.details = {}
            return next()
          },
        }),
      ],
    })
    hub.attach(rt)
    hub.emit('DK_TEST_INFO', { name: 'x' })
    hub.emit('DK_TEST_ROW', { index: 1, key: 1n })
    expect(onDiagnostic).toHaveBeenCalledTimes(1)
    expect(onDiagnostic.mock.calls[0]?.[0].details).toEqual({})
    expect(hub.getDiagnostics().map((d) => d.code)).toEqual(['DK_TEST_ROW'])
  })

  it('a throwing interceptor on diagnostic:emit is reported without recursion', () => {
    const onDiagnostic = vi.fn()
    const hub = quiet({ onDiagnostic })
    const rt = createInterceptorRuntime({
      emit: hub.emit,
      interceptors: [
        defineInterceptor({
          name: 'broken-logger',
          on: ['diagnostic:emit'],
          intercept() {
            throw new Error('boom')
          },
        }),
      ],
    })
    hub.attach(rt)
    hub.emit('DK_TEST_ROW', { index: 1, key: 1n })
    expect(onDiagnostic.mock.calls.map((c) => c[0].code).sort()).toEqual([
      'DK_INTERCEPTOR_FAILED',
      'DK_TEST_ROW',
    ])
    const failed = onDiagnostic.mock.calls.find((c) => c[0].code === 'DK_INTERCEPTOR_FAILED')?.[0]
    expect(failed.where).toEqual({
      kind: 'interceptor',
      name: 'broken-logger',
      op: 'diagnostic:emit',
    })
    expect(failed.context.cause).toBeInstanceOf(Error)
  })

  it('strict still throws through the chain', () => {
    const hub = quiet({ strict: true })
    hub.attach(createInterceptorRuntime({ emit: hub.emit }))
    expect(() => hub.emit('DK_TEST_ROW', { index: 1, key: 1n })).toThrow(DatakableError)
  })
})
