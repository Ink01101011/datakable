import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineInterceptor } from '../intercept/define'
import { createInterceptorRuntime } from '../intercept/runtime'
import { createTable } from '../table/create-table'
import { defineDiagnostic } from './catalog'
import { createDiagnostics } from './hub'
import type { RedactLevel } from './redact'

/**
 * Carry-over from R2: `ctx.where` is a free string that reaches `DK_INTERNAL` / `DK_UNKNOWN`
 * `where.slot`, the fingerprint, the prod docs URL and the issue link, and redaction does not touch
 * it. Property: no row key or cell value ever appears in a `ctx.where`; only option paths, method
 * names and indices.
 */
declare module './catalog' {
  interface DiagnosticCatalog {
    DK_TEST_WHERE_ROW: { index: number; key: string }
  }
}

defineDiagnostic({
  code: 'DK_TEST_WHERE_ROW',
  level: 'warn',
  where: (d) => ({ kind: 'row', index: d.index, key: d.key }),
  problem: () => 'test',
  impact: () => 'none',
  fix: () => ['none'],
  redact: { key: 'rowKey' },
})

// Distinct markers that cannot occur in DataKable's own option paths or method names.
const sentinel = fc.string({ minLength: 4, maxLength: 12 }).map((s) => `§${s}§`)
const levels: RedactLevel[] = ['safe', 'keys', 'full']

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('ctx.where never carries row keys or cell values', () => {
  it('diagnostic:emit of a row diagnostic, at every redaction level', () => {
    fc.assert(
      fc.property(sentinel, fc.nat(1000), fc.constantFrom(...levels), (key, index, level) => {
        const wheres: string[] = []
        const slots: unknown[] = []
        const hub = createDiagnostics({ console: false, redaction: level, dev: true })
        hub.attach(
          createInterceptorRuntime({
            interceptors: [
              defineInterceptor({
                name: 'audit',
                on: ['diagnostic:emit'],
                intercept(ctx, next) {
                  wheres.push(ctx.where)
                  return next()
                },
              }),
              defineInterceptor({
                name: 'broken',
                on: ['diagnostic:emit'],
                intercept() {
                  throw new Error('boom')
                },
              }),
            ],
            emit: (code, details) => {
              slots.push((details as { slot?: unknown }).slot)
              hub.emit(code, details)
            },
          }),
        )
        hub.emit('DK_TEST_WHERE_ROW', { index, key })
        expect(wheres.length).toBeGreaterThan(0)
        for (const w of [...wheres, ...slots]) expect(String(w)).not.toContain(key)
        expect(wheres[0]).toBe(`row #${index}`)
      }),
      { numRuns: 60 },
    )
  })

  it('every op a table runs (init, data, state, options, destroy)', () => {
    fc.assert(
      fc.property(sentinel, sentinel, (key, value) => {
        const wheres: string[] = []
        const audit = defineInterceptor({
          name: 'audit',
          on: '*',
          hot: true,
          intercept(ctx, next) {
            wheres.push(ctx.where)
            return next()
          },
        })
        const data = [{ id: key, name: value }]
        const t = createTable({
          data,
          rowKey: 'id',
          columns: [{ key: 'name' }],
          interceptors: [audit],
          diagnostics: { redact: 'full' },
        })
        t.setState({ x: value })
        t.setOptions({ data: [{ id: value, name: key }] })
        t.destroy()
        expect(wheres.length).toBeGreaterThan(0)
        for (const w of wheres) {
          expect(w).not.toContain(key)
          expect(w).not.toContain(value)
        }
      }),
      { numRuns: 30 },
    )
  })
})
