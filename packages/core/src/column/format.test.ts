import { describe, expect, it, vi } from 'vitest'
import { defaultFormat } from './format'

describe('defaultFormat', () => {
  it('renders null / undefined as an empty string', () => {
    expect(defaultFormat(null)).toBe('')
    expect(defaultFormat(undefined)).toBe('')
  })

  it('renders primitives with String()', () => {
    expect(defaultFormat('Ann')).toBe('Ann')
    expect(defaultFormat('')).toBe('')
    expect(defaultFormat(0)).toBe('0')
    expect(defaultFormat(-1.5)).toBe('-1.5')
    expect(defaultFormat(Number.NaN)).toBe('NaN')
    expect(defaultFormat(10n)).toBe('10')
    expect(defaultFormat(true)).toBe('true')
    expect(defaultFormat(false)).toBe('false')
    expect(defaultFormat(Symbol('s'))).toBe('Symbol(s)')
  })

  it('renders a valid Date with toLocaleString()', () => {
    const d = new Date(Date.UTC(2026, 9, 12, 8, 30))
    expect(defaultFormat(d)).toBe(d.toLocaleString())
  })

  it('renders an invalid Date as an empty string, without reporting it as unrenderable', () => {
    const onUnrenderable = vi.fn()
    expect(defaultFormat(new Date('nope'), onUnrenderable)).toBe('')
    expect(onUnrenderable).not.toHaveBeenCalled()
  })

  it("joins arrays of primitives with ', '", () => {
    expect(defaultFormat(['a', 'b', 'c'])).toBe('a, b, c')
    expect(defaultFormat([1, 2])).toBe('1, 2')
    expect(defaultFormat([])).toBe('')
  })

  it('formats each array element with the scalar rules', () => {
    const d = new Date(0)
    expect(defaultFormat(['a', null, undefined, 3])).toBe('a, , , 3')
    expect(defaultFormat([d])).toBe(d.toLocaleString())
  })

  it('renders objects as an empty string and reports them', () => {
    const onUnrenderable = vi.fn()
    const value = { city: 'Oslo' }
    expect(defaultFormat(value, onUnrenderable)).toBe('')
    expect(onUnrenderable).toHaveBeenCalledWith(value)
  })

  it('renders functions as an empty string and reports them', () => {
    const onUnrenderable = vi.fn()
    const fn = () => 1
    expect(defaultFormat(fn, onUnrenderable)).toBe('')
    expect(onUnrenderable).toHaveBeenCalledWith(fn)
  })

  it('reports arrays containing objects, functions or nested arrays once, with the whole array', () => {
    for (const value of [[{ id: 1 }], ['a', () => 1], [[1, 2]]]) {
      const onUnrenderable = vi.fn()
      expect(defaultFormat(value, onUnrenderable)).toBe('')
      expect(onUnrenderable).toHaveBeenCalledTimes(1)
      expect(onUnrenderable).toHaveBeenCalledWith(value)
    }
  })

  it('does not throw without a callback', () => {
    expect(defaultFormat({ a: 1 })).toBe('')
  })

  it('never throws on objects whose String() / toLocaleString() would throw', () => {
    const nullProto = Object.create(null)
    expect(defaultFormat(nullProto)).toBe('')
    expect(defaultFormat([nullProto])).toBe('')
  })

  it('never throws on values that throw when inspected (revoked Proxy, traps, array getters)', () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    const trap = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('trap')
        },
      },
    )
    const arr = [1]
    Object.defineProperty(arr, 0, {
      get() {
        throw new Error('getter')
      },
    })
    for (const value of [proxy, trap, arr]) {
      const onUnrenderable = vi.fn()
      expect(defaultFormat(value, onUnrenderable)).toBe('')
      // Identity check: vitest's deep equality would itself throw on a revoked Proxy.
      expect(
        onUnrenderable.mock.calls.length === 1 && onUnrenderable.mock.calls[0]?.[0] === value,
      ).toBe(true)
    }
  })
})
