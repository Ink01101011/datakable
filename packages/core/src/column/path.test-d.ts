import { describe, expectTypeOf, test } from 'vitest'
import type { IsAny, Path, PathValue } from './path'
import type { User } from './test-utils'

describe('Path', () => {
  test('lists top-level and nested dot-paths', () => {
    expectTypeOf<'first' | 'address.city' | 'address.geo.lat'>().toExtend<Path<User>>()
  })

  test('arrays, functions and Date are leaves', () => {
    expectTypeOf<Path<User>>().toEqualTypeOf<
      | 'id'
      | 'first'
      | 'last'
      | 'age'
      | 'active'
      | 'createdAt'
      | 'tags'
      | 'nick'
      | 'address'
      | 'address.city'
      | 'address.geo'
      | 'address.geo.lat'
      | 'address.geo.lng'
      | 'manager'
      | 'manager.name'
      | 'onClick'
      | 'friends'
    >()
  })

  test('nullable intermediates are traversed', () => {
    expectTypeOf<'manager.name'>().toExtend<Path<User>>()
  })

  test('typos are not paths', () => {
    expectTypeOf<'frist'>().not.toExtend<Path<User>>()
    expectTypeOf<'address.ctiy'>().not.toExtend<Path<User>>()
  })

  test('depth is capped at 4 traversals', () => {
    type Deep = { a: { b: { c: { d: { e: { f: number } } } } } }
    expectTypeOf<'a.b.c.d.e'>().toExtend<Path<Deep>>()
    expectTypeOf<'a.b.c.d.e.f'>().not.toExtend<Path<Deep>>()
  })

  test('recursive types terminate', () => {
    type Node = { id: number; parent: Node | null }
    expectTypeOf<'parent.parent.parent.parent.id'>().toExtend<Path<Node>>()
  })
})

describe('PathValue', () => {
  test('resolves the value type at a path', () => {
    expectTypeOf<PathValue<User, 'first'>>().toEqualTypeOf<string>()
    expectTypeOf<PathValue<User, 'address.geo.lat'>>().toEqualTypeOf<number>()
    expectTypeOf<PathValue<User, 'address.geo'>>().toEqualTypeOf<{ lat: number; lng: number }>()
    expectTypeOf<PathValue<User, 'friends'>>().toEqualTypeOf<{ id: number }[]>()
  })

  test('keeps null from a nullable intermediate', () => {
    expectTypeOf<PathValue<User, 'manager.name'>>().toEqualTypeOf<string | null>()
  })

  test('is never for a non-path', () => {
    expectTypeOf<PathValue<User, 'nope'>>().toBeNever()
  })
})

describe('IsAny', () => {
  test('detects any only', () => {
    // biome-ignore lint/suspicious/noExplicitAny: the subject under test
    expectTypeOf<IsAny<any>>().toEqualTypeOf<true>()
    expectTypeOf<IsAny<unknown>>().toEqualTypeOf<false>()
    expectTypeOf<IsAny<never>>().toEqualTypeOf<false>()
    expectTypeOf<IsAny<User>>().toEqualTypeOf<false>()
  })
})
