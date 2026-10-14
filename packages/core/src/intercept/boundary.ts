import { DatakableError } from '../diagnostics/build'
import { keepDiagnostics } from '../diagnostics/catalog'
import { DEV } from '../diagnostics/env'
import { expandProse } from '../diagnostics/prose'
import { scrubError } from '../diagnostics/redact'
import type { EmitOptions } from '../diagnostics/types'
import { type CallbackError, classifyError, errorName } from './classify'
import { boundaryDiagnostics } from './codes'
import type { InterceptorContext } from './context'
import type { Interceptor } from './define'
import { FAILED, getFallback } from './fallbacks'
import type { OpName } from './operations'

keepDiagnostics(boundaryDiagnostics)

/** Emitters (one per table) that already printed their silent `diagnostic:emit` failure. */
const silenced = new WeakSet<object>()

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  v != null && typeof (v as { then?: unknown }).then === 'function'

/** catch → classify → emit → registry fallback (§3.4). */
function recover(ctx: InterceptorContext, error: unknown): unknown {
  // Config errors, `strict: true` rethrows and core invariants are meant to reach the caller.
  if (error instanceof DatakableError) throw error
  ctx.meta.set(FAILED, error)
  const fallback = getFallback(ctx.op)
  if (fallback.silent) {
    if (!silenced.has(ctx.emit)) {
      silenced.add(ctx.emit)
      // Production prints the error name only: its message can embed row values (§8.2).
      console.error(
        `[DataKable] ${ctx.op} failed; ${expandProse(fallback.describe, DEV)}. Later failures are silent.`,
        DEV ? error : scrubError(error),
      )
    }
    return fallback.value(ctx as never)
  }
  const opts: EmitOptions = { run: ctx.run, trigger: ctx.trigger, phase: ctx.phase }
  const slot = ctx.where ? { slot: ctx.where } : {}
  const code = classifyError(error)
  if (code === 'DK_CALLBACK_FAILED') {
    const e = error as CallbackError
    const name = errorName(e.cause)
    ctx.emit(
      'DK_CALLBACK_FAILED',
      {
        slot: e.slot,
        ...(e.op === undefined ? {} : { op: e.op }),
        ...(e.row === undefined ? {} : { rows: [e.row] }),
        count: 1,
        fallback: fallback.describe,
        ...(name === undefined ? {} : { errorName: name }),
      },
      { ...opts, cause: e.cause },
    )
  } else if (code === 'DK_INTERNAL') {
    ctx.emit(
      'DK_INTERNAL',
      {
        op: ctx.op,
        problem: 'escaped',
        message: (error as Error).message,
        ...slot,
        errorName: (error as Error).name,
        fallback: fallback.describe,
      },
      { ...opts, cause: error },
    )
  } else {
    const name = errorName(error)
    ctx.emit(
      'DK_UNKNOWN',
      {
        op: ctx.op,
        ...slot,
        ...(name === undefined ? {} : { errorName: name }),
        fallback: fallback.describe,
      },
      { ...opts, cause: error },
    )
  }
  return fallback.value(ctx as never)
}

/**
 * The outermost, non-removable interceptor (§3.4, §8.6). Install it once per table with
 * `runtime.installBoundary(errorBoundary)`. Reports through `ctx.emit`, so its sinks are the table's
 * diagnostics sinks. Hot-safe: the success path is one `try` and a thenable check, no allocation.
 */
export const errorBoundary: Interceptor<OpName> = {
  name: 'errorBoundary',
  on: '*',
  hot: true,
  intercept(ctx, next) {
    let out: unknown
    try {
      out = next()
    } catch (e) {
      return recover(ctx, e) as never
    }
    if (isThenable(out)) {
      return Promise.resolve(out).then(undefined, (e: unknown) => recover(ctx, e)) as never
    }
    return out as never
  },
}
