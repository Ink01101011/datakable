import { describe, expectTypeOf, test } from 'vitest'
import type { InterceptorContext } from './context'
import { defineInterceptor, type Interceptor } from './define'
import type { OpInput, OpName, OpOutput, OpResult } from './operations'

// An op added the way features / @datakable/react will add theirs.
declare module './operations' {
  interface Operations {
    'test:merged': { kind: 'sync'; input: { n: number }; output: string }
  }
}

describe('operation typing', () => {
  test('result type follows the op kind', () => {
    expectTypeOf<OpResult<'pipeline:step'>>().toEqualTypeOf<Uint32Array>()
    expectTypeOf<OpResult<'async:request'>>().toEqualTypeOf<Promise<unknown>>()
    expectTypeOf<OpResult<'data:ingest'>>().toEqualTypeOf<
      readonly unknown[] | Promise<readonly unknown[]>
    >()
  })

  test('the §3.4 ops are registered', () => {
    expectTypeOf<
      | 'table:init'
      | 'table:setOptions'
      | 'table:destroy'
      | 'state:dispatch'
      | 'data:ingest'
      | 'pipeline:run'
      | 'pipeline:step'
      | 'column:batch'
      | 'async:request'
      | 'diagnostic:emit'
    >().toExtend<OpName>()
  })

  test('declaration merging adds an op', () => {
    expectTypeOf<OpInput<'test:merged'>>().toEqualTypeOf<{ n: number }>()
    expectTypeOf<OpOutput<'test:merged'>>().toEqualTypeOf<string>()
  })
})

describe('defineInterceptor', () => {
  test('sync op: next() is not a Promise', () => {
    defineInterceptor({
      name: 'timing',
      on: ['pipeline:step'],
      intercept(ctx, next) {
        expectTypeOf(ctx.op).toEqualTypeOf<'pipeline:step'>()
        expectTypeOf(ctx.input).toEqualTypeOf<OpInput<'pipeline:step'>>()
        const r = next()
        expectTypeOf(r).toEqualTypeOf<Uint32Array>()
        ctx.meta.set('ms', 1)
        return r
      },
    })
  })

  test('async op: next() is a Promise and the interceptor may be async', () => {
    defineInterceptor({
      name: 'timeout',
      on: ['async:request'],
      async intercept(_ctx, next) {
        expectTypeOf(next()).toEqualTypeOf<Promise<unknown>>()
        return await next()
      },
    })
  })

  test("'sync|async' op accepts both a value and a Promise", () => {
    defineInterceptor({ name: 'a', on: ['data:ingest'], intercept: (_c, next) => next() })
    defineInterceptor({ name: 'b', on: ['data:ingest'], intercept: async (_c, next) => next() })
  })

  test('sync op returning a Promise is a compile error', () => {
    defineInterceptor({
      name: 'bad',
      on: ['pipeline:step'],
      // @ts-expect-error sync op must not return a Promise
      async intercept(_c, next) {
        return next()
      },
    })
  })

  test('wrong output type is a compile error', () => {
    defineInterceptor({
      name: 'bad2',
      on: ['pipeline:step'],
      // @ts-expect-error pipeline:step must return Uint32Array, not a string
      intercept() {
        return 'x'
      },
    })
  })

  test('unknown op is a compile error', () => {
    // @ts-expect-error 'pipeline:nope' is not a registered op
    defineInterceptor({ name: 'bad3', on: ['pipeline:nope'], intercept: (_c, next) => next() })
  })

  test("several ops: ctx is a union narrowed by ctx.op; '*' covers every op", () => {
    defineInterceptor({
      name: 'multi',
      on: ['pipeline:step', 'state:dispatch'],
      intercept(ctx, next) {
        if (ctx.op === 'pipeline:step') expectTypeOf(ctx.input.indices).toEqualTypeOf<Uint32Array>()
        return next()
      },
    })
    const all = defineInterceptor({ name: 'all', on: '*', hot: true, intercept: (_c, n) => n() })
    expectTypeOf(all).toEqualTypeOf<Interceptor<OpName>>()
  })

  test('any interceptor fits in a list of Interceptor<OpName>', () => {
    const step = defineInterceptor({ name: 's', on: ['pipeline:step'], intercept: (_c, n) => n() })
    expectTypeOf(step).toExtend<Interceptor<OpName>>()
  })

  test('ctx carries the §3.4 fields', () => {
    expectTypeOf<InterceptorContext<'pipeline:run'>>().toHaveProperty('where')
    expectTypeOf<InterceptorContext<'pipeline:run'>['run']>().toEqualTypeOf<number>()
    expectTypeOf<InterceptorContext<'pipeline:run'>['phase']>().toEqualTypeOf<
      'ssr' | 'hydrate' | 'client'
    >()
    expectTypeOf<InterceptorContext<'pipeline:run'>['signal']>().toEqualTypeOf<
      AbortSignal | undefined
    >()
    expectTypeOf<InterceptorContext<'pipeline:run'>>().toHaveProperty('emit')
    expectTypeOf<InterceptorContext<'pipeline:run'>>().toHaveProperty('table')
    expectTypeOf<InterceptorContext<'pipeline:run'>>().toHaveProperty('trigger')
  })
})
