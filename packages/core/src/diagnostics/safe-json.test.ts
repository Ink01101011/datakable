import { describe, expect, it } from 'vitest'
import { toSafeJson } from './safe-json'

describe('toSafeJson', () => {
  it('turns bigint into a string and keeps JSON.stringify from throwing', () => {
    const v = { n: 10n, list: [1n] }
    expect(() => JSON.stringify(v)).toThrow()
    expect(toSafeJson(v)).toEqual({ n: '10n', list: ['1n'] })
    expect(() => JSON.stringify(toSafeJson(v))).not.toThrow()
  })

  it('replaces cycles but keeps shared non-cyclic references', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a.self = a
    const shared = { x: 1 }
    expect(toSafeJson({ a, p: shared, q: shared })).toEqual({
      a: { name: 'a', self: '[Circular]' },
      p: { x: 1 },
      q: { x: 1 },
    })
    const arr: unknown[] = [1]
    arr.push(arr)
    expect(toSafeJson(arr)).toEqual([1, '[Circular]'])
  })

  it('serialises Errors with name, message and cause', () => {
    const e = new TypeError('bad', { cause: new Error('root') })
    expect(toSafeJson(e)).toEqual({
      name: 'TypeError',
      message: 'bad',
      cause: { name: 'Error', message: 'root' },
    })
  })

  it('handles Map, Set, Date, typed arrays, functions, symbols and non-finite numbers', () => {
    const out = toSafeJson({
      m: new Map([[1, 'a']]),
      s: new Set([2]),
      d: new Date(0),
      bad: new Date(Number.NaN),
      t: new Uint32Array(3),
      f: function named() {},
      anon: () => {},
      sym: Symbol('k'),
      nan: Number.NaN,
      inf: Number.NEGATIVE_INFINITY,
      u: undefined,
    }) as Record<string, unknown>
    expect(out.m).toEqual([[1, 'a']])
    expect(out.s).toEqual([2])
    expect(out.d).toBe('1970-01-01T00:00:00.000Z')
    expect(out.bad).toBe('Invalid Date')
    expect(out.t).toBe('[Uint32Array(3)]')
    expect(out.f).toBe('[Function named]')
    expect(out.anon).toBe('[Function anon]')
    expect(out.sym).toBe('Symbol(k)')
    expect(out.nan).toBe('NaN')
    expect(out.inf).toBe('-Infinity')
    expect('u' in out).toBe(false)
  })

  it('uses a foreign toJSON but survives one that throws', () => {
    expect(toSafeJson({ v: { toJSON: () => ({ ok: 1n }) } })).toEqual({ v: { ok: '1n' } })
    const boom = {
      toJSON() {
        throw new Error('no')
      },
    }
    expect(toSafeJson(boom)).toBe('[Unserializable]')
  })

  it('stops at a depth limit', () => {
    let deep: Record<string, unknown> = {}
    const root = deep
    for (let i = 0; i < 50; i++) {
      const next = {}
      deep.n = next
      deep = next
    }
    expect(JSON.stringify(toSafeJson(root))).toContain('[MaxDepth]')
  })

  it('survives throwing getters and revoked Proxies', () => {
    const getter = {
      ok: 1,
      get bad() {
        throw new Error('boom')
      },
    }
    expect(toSafeJson(getter)).toEqual({ ok: 1, bad: '[Unserializable]' })
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    expect(toSafeJson({ p: proxy })).toEqual({ p: '[Unserializable]' })
  })
})
