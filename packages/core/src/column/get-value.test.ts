import { describe, expect, it, vi } from 'vitest'
import { compilePath, getValue } from './get-value'

const row = {
  id: 1,
  name: 'Ann',
  zero: 0,
  empty: '',
  flag: false,
  createdAt: new Date(0),
  tags: ['a', 'b'],
  friends: [{ id: 2 }],
  address: { city: 'Oslo', geo: { lat: 59.9, lng: 10.7 } },
  manager: null as { name: string } | null,
  nick: undefined as string | undefined,
  onClick: () => {},
}

describe('getValue', () => {
  it('reads top-level and nested keys', () => {
    expect(getValue(row, 'name')).toBe('Ann')
    expect(getValue(row, 'address.city')).toBe('Oslo')
    expect(getValue(row, 'address.geo.lat')).toBe(59.9)
  })

  it('returns falsy leaves as-is', () => {
    expect(getValue(row, 'zero')).toBe(0)
    expect(getValue(row, 'empty')).toBe('')
    expect(getValue(row, 'flag')).toBe(false)
    expect(getValue(row, 'manager')).toBeNull()
  })

  it('returns object, array, Date and function leaves by reference', () => {
    expect(getValue(row, 'address')).toBe(row.address)
    expect(getValue(row, 'tags')).toBe(row.tags)
    expect(getValue(row, 'createdAt')).toBe(row.createdAt)
    expect(getValue(row, 'onClick')).toBe(row.onClick)
  })

  it('yields undefined for null / undefined part-way through', () => {
    expect(getValue(row, 'manager.name')).toBeUndefined()
    expect(getValue(row, 'nick.length')).toBeUndefined()
    expect(getValue(row, 'missing.deep.path')).toBeUndefined()
  })

  it('yields undefined for a non-object part-way through', () => {
    expect(getValue(row, 'name.length')).toBeUndefined()
    expect(getValue(row, 'zero.toFixed')).toBeUndefined()
    expect(getValue(row, 'flag.x')).toBeUndefined()
    expect(getValue(row, 'onClick.name')).toBeUndefined()
  })

  it('walks into arrays by index (runtime JSON with loose paths)', () => {
    expect(getValue(row, 'tags.1')).toBe('b')
    expect(getValue(row, 'friends.0.id')).toBe(2)
    expect(getValue(row, 'friends.5.id')).toBeUndefined()
  })

  it('reads Date leaves and Date own-less keys without throwing', () => {
    expect(getValue(row, 'createdAt')).toBeInstanceOf(Date)
    expect(getValue(row, 'createdAt.nope')).toBeUndefined()
  })

  it('handles a null / undefined / primitive row', () => {
    expect(getValue(null, 'a')).toBeUndefined()
    expect(getValue(undefined, 'a.b')).toBeUndefined()
    expect(getValue(42, 'a')).toBeUndefined()
  })

  it('reads keys via prototype getters (class instances)', () => {
    class Person {
      constructor(private readonly first: string) {}
      get label() {
        return `#${this.first}`
      }
    }
    expect(getValue({ p: new Person('Bo') }, 'p.label')).toBe('#Bo')
  })

  it('never reads inherited Object.prototype members (#42)', () => {
    for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(getValue({ id: 1 }, k)).toBeUndefined()
      expect(getValue({ a: { id: 1 } }, `a.${k}`)).toBeUndefined()
    }
    expect(getValue({ a: [1] }, 'a.map')).toBeUndefined()
    // Own members of the same names are data.
    const own = JSON.parse('{"constructor":"c","__proto__":"p","toString":"t"}')
    expect([
      getValue(own, 'constructor'),
      getValue(own, '__proto__'),
      getValue(own, 'toString'),
    ]).toEqual(['c', 'p', 't'])
  })

  it('catches a throwing getter, returns undefined and reports the error', () => {
    const boom = new Error('boom')
    const bad = {
      get secret(): string {
        throw boom
      },
    }
    const onError = vi.fn()
    expect(() => getValue(bad, 'secret')).not.toThrow()
    expect(getValue(bad, 'secret', onError)).toBeUndefined()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(boom)
  })

  it('catches a throwing getter part-way through', () => {
    const bad = {
      get a(): { b: number } {
        throw new TypeError('nope')
      },
    }
    const onError = vi.fn()
    expect(getValue(bad, 'a.b', onError)).toBeUndefined()
    expect(onError).toHaveBeenCalledWith(expect.any(TypeError))
  })

  it('catches throwing Proxy traps', () => {
    const proxy = new Proxy(
      {},
      {
        get() {
          throw new Error('trap')
        },
      },
    )
    const onError = vi.fn()
    expect(getValue({ p: proxy }, 'p.x', onError)).toBeUndefined()
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('catches a revoked Proxy', () => {
    const { proxy, revoke } = Proxy.revocable({ x: 1 }, {})
    revoke()
    const onError = vi.fn()
    expect(getValue(proxy, 'x', onError)).toBeUndefined()
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('does not call onError on a normal miss', () => {
    const onError = vi.fn()
    getValue(row, 'manager.name', onError)
    getValue(row, 'name.length', onError)
    expect(onError).not.toHaveBeenCalled()
  })
})

describe('compilePath', () => {
  it('splits a dot-path once into segments', () => {
    expect(compilePath('address.geo.lat')).toEqual(['address', 'geo', 'lat'])
    expect(compilePath('name')).toEqual(['name'])
  })

  it('gives getValue the same result as the string form', () => {
    const segs = compilePath('address.geo.lng')
    expect(getValue(row, segs)).toBe(getValue(row, 'address.geo.lng'))
    expect(getValue(row, compilePath('manager.name'))).toBeUndefined()
  })
})
