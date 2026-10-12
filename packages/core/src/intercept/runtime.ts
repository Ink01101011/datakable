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
   * An interceptor threw (or its promise rejected); it was skipped. T06 turns this into
   * DK_INTERCEPTOR_FAILED. Default: console.error.
   */
  onInterceptorError?: (
    error: unknown,
    interceptor: Interceptor<OpName>,
    ctx: InterceptorContext,
  ) => void
  /** An interceptor is attached to a hot op without `hot: true`. T05 routes it to diagnostics. */
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

// Measured by intercept/chain.bench.ts (Apple M4 Pro, Node 25.2.1): one pass-through interceptor
// adds ~10 ns per call; spec §9.2 measured +15% when the same wrapping is done per cell.
const HOT_COST =
  '~10 ns per call per interceptor (+15% on a per-cell format call, spec §9.2) on top of ' +
  'the interceptor body, which runs columns × pipeline runs times'

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

const defaultInterceptorError = (error: unknown, i: Interceptor<OpName>, ctx: AnyCtx) => {
  // TODO(T06): replaced by DK_INTERCEPTOR_FAILED through diagnostic:emit.
  console.error(`[DataKable] interceptor "${i.name}" failed on ${ctx.op} and was skipped`, error)
}

const defaultHotWarning = (w: HotOpWarning) => {
  // TODO(T05): routed to diagnostics and stripped in production.
  console.warn(`[DataKable] ${w.message}`)
}

export function createInterceptorRuntime(
  options: InterceptorRuntimeOptions = {},
): InterceptorRuntime {
  const onError = options.onInterceptorError ?? defaultInterceptorError
  const onHotWarning = options.onHotWarning ?? defaultHotWarning
  const { onCompile } = options
  const report = (error: unknown, i: Interceptor<OpName>, ctx: AnyCtx) => {
    try {
      onError(error, i, ctx)
    } catch {
      // The reporter must never break the operation it reports on.
    }
  }

  let list: readonly Interceptor<OpName>[] = []
  let boundary: Interceptor<OpName> | undefined
  const chains = new Map<string, Chain>()

  function compile(op: string): Chain {
    const info = getOperation(op)
    // TODO(T05): becomes a diagnostic code (internal error: unregistered op).
    if (!info) throw new Error(`Unknown operation "${op}": register it with registerOperation()`)
    const mine = list.filter((i) => attaches(i, op))
    if (boundary && attaches(boundary, op)) mine.unshift(boundary)
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

  function warnHot(interceptors: readonly Interceptor<OpName>[]) {
    for (const i of interceptors) {
      if (i.hot) continue
      for (const op of listOperations()) {
        if (!getOperation(op)?.hot || !attaches(i, op)) continue
        onHotWarning({
          interceptor: i,
          op,
          message:
            `Interceptor "${i.name}" is attached to hot op "${op}" without hot: true. ` +
            `It runs once per column per pipeline run; measured cost: ${HOT_COST}. ` +
            'Never loop per cell inside it. Set hot: true to accept the cost, ' +
            'or attach it to a cold op.',
        })
      }
    }
  }

  function setInterceptors(next: readonly Interceptor<OpName>[]) {
    list = [...next]
    warnHot(list)
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
      // TODO(T05): becomes a diagnostic code.
      if (boundary)
        throw new Error(`A boundary interceptor is already installed ("${boundary.name}")`)
      boundary = b
      warnHot([b])
      compileAll()
    },
  }
}
