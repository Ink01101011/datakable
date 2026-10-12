import type { InterceptorContext } from './context'
import type { OpName, OpResult } from './operations'

/**
 * An interceptor over one or more operations. The type of `next()` and of the return value follow
 * the op kind: a Promise for async ops, never a Promise for sync ops (§3.4).
 */
export interface Interceptor<O extends OpName = OpName> {
  readonly name: string
  /** The ops to attach to, or `'*'` for every registered op. */
  readonly on: readonly O[] | '*'
  /** Must be `true` to attach to a hot op without a dev warning. */
  readonly hot?: boolean
  intercept(ctx: InterceptorContext<O>, next: () => OpResult<O>): OpResult<O>
}

/** Identity at runtime; exists for inference — `O` is taken from `on`, then types `ctx` / `next`. */
export function defineInterceptor<const O extends OpName = OpName>(
  interceptor: Interceptor<O>,
): Interceptor<O> {
  return interceptor
}
