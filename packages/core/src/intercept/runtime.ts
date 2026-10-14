import { DatakableError, internalError } from '../diagnostics/build'
import { DEV } from '../diagnostics/env'
import type { Emit } from '../diagnostics/types'
import type { InterceptorContext } from './context'
import type { Interceptor } from './define'
import { getOperation, listOperations, type OpName, type OpResult } from './operations'

export type Core<O extends OpName> = (ctx: InterceptorContext<O>) => OpResult<O>

export interface HotOpWarning {
  interceptor: Interceptor<OpName>
  op: string
  message: string
}

export interface InterceptorRuntimeOptions {
  interceptors?: readonly Interceptor<OpName>[]
  /**
   * The table's diagnostic emitter. When given, the default hooks below report through it:
   * `DK_INTERCEPTOR_FAILED` and (dev only) `DK_HOT_INTERCEPTOR`. Without it they use the console.
   */
  emit?: Emit
  /**
   * An interceptor threw (or its promise rejected); it was skipped. Overrides the default report
   * (`DK_INTERCEPTOR_FAILED` via `emit`, else console.error).
   */
  onInterceptorError?: (
    error: unknown,
    interceptor: Interceptor<OpName>,
    ctx: InterceptorContext,
  ) => void
  /**
   * An interceptor is attached to a hot op without `hot: true` (checked when the op's chain is
   * compiled, once per interceptor + op). Overrides the default (`DK_HOT_INTERCEPTOR` via `emit`).
   */
  onHotWarning?: (warning: HotOpWarning) => void
  /** Called each time a chain is compiled (tracing / tests). `length` counts the boundary too. */
  onCompile?: (op: string, length: number) => void
}

export interface InterceptorRuntime {
  /** Runs `core` for `op` through the compiled chain. */
  run<O extends OpName>(op: O, ctx: InterceptorContext<O>, core: NoInfer<Core<O>>): OpResult<O>
  /** Replaces the user / feature interceptors and recompiles. The boundary slot is kept. */
  setInterceptors(interceptors: readonly Interceptor<OpName>[]): void
  /** Installs the outermost, non-removable interceptor (errorBoundary, T06). Once only. */
  installBoundary(boundary: Interceptor<OpName>): void
}

type AnyCtx = InterceptorContext
type AnyCore = (ctx: AnyCtx) => unknown
type Chain = (ctx: AnyCtx, core: AnyCore) => unknown

const NOT_CALLED = 0
const CALLED = 1
const FAILED_INSIDE = 2

const direct: Chain = (ctx, core) => core(ctx)

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  v != null && typeof (v as { then?: unknown }).then === 'function'

const attaches = (i: Interceptor<OpName>, op: string) =>
  i.on === '*' || (i.on as readonly string[]).includes(op)

/**
 * Wraps one interceptor around `inner`. Skip semantics (§3.4): if the interceptor throws before
 * calling `next`, `next` runs directly; if it throws after, the result `next` produced is kept so
 * the core never runs twice. An error that came out of `next` belongs to an inner layer and is
 * rethrown untouched. Async results get the same rules on rejection.
 */
function wrap(
  i: Interceptor<OpName>,
  inner: Chain,
  mayBeAsync: boolean,
  report: (error: unknown, i: Interceptor<OpName>, ctx: AnyCtx) => void,
): Chain {
  const intercept = i.intercept as (ctx: AnyCtx, next: () => unknown) => unknown
  return (ctx, core) => {
    let state = NOT_CALLED
    let out: unknown
    const next = () => {
      state = CALLED
      try {
        out = inner(ctx, core)
      } catch (e) {
        state = FAILED_INSIDE
        throw e
      }
      if (mayBeAsync && isThenable(out)) {
        const p = Promise.resolve(out).then(undefined, (e: unknown) => {
          state = FAILED_INSIDE
          throw e
        })
        // Handled here so an interceptor that drops `next()` never causes an unhandled rejection;
        // whoever awaits `p` still sees the rejection.
        p.catch(() => {})
        out = p
      }
      return out
    }
    const recover = (e: unknown) => {
      if (state === FAILED_INSIDE) throw e
      report(e, i, ctx)
      return state === CALLED ? out : inner(ctx, core)
    }
    let r: unknown
    try {
      r = intercept(ctx, next)
    } catch (e) {
      return recover(e)
    }
    return mayBeAsync && isThenable(r) ? Promise.resolve(r).then(undefined, recover) : r
  }
}

export function createInterceptorRuntime(
  options: InterceptorRuntimeOptions = {},
): InterceptorRuntime {
  const { emit, onCompile } = options
  const onError =
    options.onInterceptorError ??
    ((error: unknown, i: Interceptor<OpName>, ctx: AnyCtx) => {
      if (emit) {
        emit(
          'DK_INTERCEPTOR_FAILED',
          { interceptor: i.name, op: ctx.op, slot: ctx.where },
          { cause: error, run: ctx.run, trigger: ctx.trigger, phase: ctx.phase },
        )
      } else {
        console.error(
          `[DataKable] interceptor "${i.name}" failed on ${ctx.op} and was skipped`,
          error,
        )
      }
    })
  // Dev-only (DK_HOT_INTERCEPTOR): `undefined` in production, with the code and its text.
  const onHotWarning = DEV
    ? (options.onHotWarning ??
      ((w: HotOpWarning) => {
        if (emit) emit('DK_HOT_INTERCEPTOR', { interceptor: w.interceptor.name, op: w.op })
        else console.warn(`[DataKable] ${w.message}`)
      }))
    : undefined
  const report = (error: unknown, i: Interceptor<OpName>, ctx: AnyCtx) => {
    try {
      onError(error, i, ctx)
    } catch (e) {
      // The reporter must never break the operation it reports on — except `strict: true`, whose
      // DatakableError is the requested behaviour.
      if (e instanceof DatakableError) throw e
    }
  }

  let list: readonly Interceptor<OpName>[] = []
  let boundary: Interceptor<OpName> | undefined
  const chains = new Map<string, Chain>()
  /** (interceptor, op) pairs already warned about, so recompiles do not repeat the warning. */
  const warned = DEV ? new WeakMap<Interceptor<OpName>, Set<string>>() : undefined

  function warnHot(i: Interceptor<OpName>, op: string) {
    if (!DEV || !warned || !onHotWarning) return // dev-only: production bundles drop the text below
    let ops = warned.get(i)
    if (ops?.has(op)) return
    if (!ops) {
      ops = new Set()
      warned.set(i, ops)
    }
    ops.add(op)
    try {
      onHotWarning({
        interceptor: i,
        op,
        message:
          `Interceptor "${i.name}" is attached to hot op "${op}" without hot: true. ` +
          // Measured by intercept/chain.bench.ts (Apple M4 Pro, Node 25.2.1). Inline here, inside
          // the DEV-only function, so production bundles carry none of it.
          'It runs once per column per pipeline run; measured cost: ~10 ns per call per ' +
          'interceptor (+15% on a per-cell format call, spec §9.2) on top of the interceptor ' +
          'body, which runs columns × pipeline runs times. ' +
          'Never loop per cell inside it. Set hot: true to accept the cost, ' +
          'or attach it to a cold op.',
      })
    } catch {
      // A warning must never break compilation.
    }
  }

  function compile(op: string): Chain {
    const info = getOperation(op)
    if (!info) {
      throw internalError(op, `unknown-op|${op}`)
    }
    const mine = list.filter((i) => attaches(i, op))
    if (boundary && attaches(boundary, op)) mine.unshift(boundary)
    // Checked here, not when the list is set, so ops registered after creation are covered too.
    if (DEV && info.hot) for (const i of mine) if (!i.hot) warnHot(i, op)
    const mayBeAsync = info.kind !== 'sync'
    const chain = mine.reduceRight<Chain>((inner, i) => wrap(i, inner, mayBeAsync, report), direct)
    chains.set(op, chain)
    onCompile?.(op, mine.length)
    return chain
  }

  function compileAll() {
    chains.clear()
    for (const op of listOperations()) compile(op)
  }

  function setInterceptors(next: readonly Interceptor<OpName>[]) {
    list = [...next]
    compileAll()
  }

  setInterceptors(options.interceptors ?? [])

  return {
    run(op, ctx, core) {
      const chain = chains.get(op) ?? compile(op)
      return chain(ctx, core as AnyCore) as OpResult<typeof op>
    },
    setInterceptors,
    installBoundary(b) {
      if (boundary) {
        throw internalError('*', `boundary-twice|${boundary.name}|${b.name}`)
      }
      boundary = b
      compileAll()
    },
  }
}
