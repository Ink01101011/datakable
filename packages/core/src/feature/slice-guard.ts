import { defineDiagnostic, keepDiagnostics } from '../diagnostics/catalog'
import { DEV } from '../diagnostics/env'
import { defineInterceptor } from '../intercept/define'
import { stateMessages } from '../table/state-codes'
import type { Table, TableState } from '../table/types'
import type { FeatureContext } from './types'

/** Defined here: only the development guard reports it, so production bundles drop it. */
export const sliceGuardDiagnostics = [
  defineDiagnostic(
    {
      code: 'DK_INVALID_STATE',
      level: 'warn',
      where: (d) => ({ kind: 'option', path: `state.${d.slice}` }),
    },
    DEV && stateMessages.DK_INVALID_STATE,
  ),
]

keepDiagnostics(sliceGuardDiagnostics)

/** A replacement for a malformed slice: the valid slice, what was wrong, what was stored. */
export type SliceFix<S> = readonly [slice: S, received: string, fallback: string]

/**
 * Replaces a malformed slice written to the store (`initialState`, `setState`, the controlled
 * `options.state`), like pagination's sanitize, with `DK_INVALID_STATE` (#89): restored state (URL,
 * storage) is untrusted. Development only: production reads a malformed slice as empty in the
 * feature's API and row model instead. `fix(s)` returns `undefined` for a valid slice. One guard per
 * feature instance; the instance may serve several tables.
 */
export function sliceGuard<S>(name: string, fix: (s: unknown) => SliceFix<S> | undefined) {
  const hosts = new WeakMap<object, FeatureContext<S>>()
  const check = (ctx: FeatureContext<S>, s: unknown) => {
    const out = fix(s)
    if (!out) return
    ctx.emit('DK_INVALID_STATE', { slice: name, received: out[1], fallback: out[2] })
    ctx.setState(out[0])
  }
  return {
    interceptor: defineInterceptor({
      name: `${name}.state`,
      on: ['state:dispatch', 'table:setOptions'],
      intercept(ictx, next) {
        const ctx = hosts.get(ictx.table as object)
        if (!ctx) return next()
        const before = (ictx.table as Table<unknown, TableState>).getState()[name]
        const out = next()
        const now = ctx.getState()
        if (!Object.is(before, now)) check(ctx, now)
        return out
      },
    }),
    /** Registers the table (call from `createApi`) and checks the slice it starts with. */
    install(ctx: FeatureContext<S>) {
      hosts.set(ctx.table, ctx)
      check(ctx, ctx.getState())
    },
  }
}
