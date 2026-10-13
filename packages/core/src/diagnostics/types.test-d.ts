import { describe, expectTypeOf, it } from 'vitest'
import type { ContextBase, InterceptorContext } from '../intercept/context'
import { defineDiagnostic } from './catalog'
import type { Diagnostic, DiagnosticCode, Emit } from './types'

declare module './catalog' {
  interface DiagnosticCatalog {
    DK_TYPES_PROBE: { column: string }
  }
}

declare const emit: Emit

describe('diagnostic types', () => {
  it('emit is typed by code: details must match the catalog entry', () => {
    emit('DK_TYPES_PROBE', { column: 'a' })
    emit('DK_INTERCEPTOR_FAILED', { interceptor: 'x', op: 'state:dispatch', slot: 'setState' })
    // @ts-expect-error unknown code
    emit('DK_NOT_A_CODE', {})
    // @ts-expect-error wrong details type
    emit('DK_TYPES_PROBE', { column: 1 })
    // @ts-expect-error missing details
    emit('DK_TYPES_PROBE', {})
  })

  it('defineDiagnostic types the builders from the code', () => {
    defineDiagnostic({
      code: 'DK_TYPES_PROBE',
      level: 'warn',
      where: (d) => {
        expectTypeOf(d).toEqualTypeOf<{ column: string }>()
        return { kind: 'option', path: d.column }
      },
      problem: (d) => d.column,
      impact: () => 'x',
      fix: () => ['y'],
    })
    defineDiagnostic({
      // @ts-expect-error code not in the catalog
      code: 'DK_NOT_IN_CATALOG',
      level: 'warn',
      where: () => ({ kind: 'option', path: 'p' }),
      problem: () => '',
      impact: () => '',
      fix: () => [],
    })
    defineDiagnostic({
      code: 'DK_TYPES_PROBE',
      level: 'warn',
      // @ts-expect-error a Location needs a known kind
      where: () => ({ kind: 'nowhere' }),
      problem: () => '',
      impact: () => '',
      fix: () => [],
    })
  })

  it('ctx.emit is the typed emitter; diagnostic:emit carries a Diagnostic', () => {
    expectTypeOf<ContextBase['emit']>().toEqualTypeOf<Emit>()
    expectTypeOf<InterceptorContext<'diagnostic:emit'>['input']>().toEqualTypeOf<{
      diagnostic: Diagnostic
    }>()
    expectTypeOf<'DK_TYPES_PROBE'>().toExtend<DiagnosticCode>()
  })
})
