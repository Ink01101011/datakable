import type { Emit, Phase, Trigger } from '../diagnostics/types'
import type { OpInput, OpName } from './operations'

/** Values that describe the table run rather than the single call; same as diagnostics context (§8.1). */
export interface ContextBase {
  /** The table instance (a `Table`; typed `unknown` so this layer does not import the store). */
  table: unknown
  /** Pipeline run id — joins explain() and diagnostics. */
  run: number
  trigger: Trigger
  phase: Phase
  /** Emits a catalog diagnostic; `details` is typed by the code (diagnostics/catalog.ts). */
  emit: Emit
}

interface ContextOf<O extends OpName> extends ContextBase {
  op: O
  input: OpInput<O>
  /** Slot / location string, e.g. `columns[2].format`. Hot ops build detailed locations lazily. */
  where: string
  /** Scratch space shared by the interceptors of one call (e.g. timings). */
  meta: Map<string, unknown>
  /** Always present (possibly `undefined`) so pooled ctxs keep one object shape. */
  signal?: AbortSignal | undefined
}

/** The ctx an interceptor receives. For several ops it is a union narrowed by `ctx.op`. */
export type InterceptorContext<O extends OpName = OpName> = O extends OpName ? ContextOf<O> : never

export function createContext<O extends OpName>(
  op: O,
  input: OpInput<O>,
  where: string,
  base: ContextBase,
  signal?: AbortSignal,
): InterceptorContext<O> {
  const ctx: ContextOf<O> = {
    op,
    input,
    where,
    table: base.table,
    run: base.run,
    trigger: base.trigger,
    phase: base.phase,
    emit: base.emit,
    meta: new Map(),
    signal,
  }
  return ctx as InterceptorContext<O>
}

/** Emitter of a released ctx: the table's own emitter is dropped so the pool does not retain it. */
const released: Emit = () => {}

export interface ContextPool {
  /** Takes a ctx from the free list (or makes one) and fills it. Release it when the call ends. */
  acquire<O extends OpName>(
    op: O,
    input: OpInput<O>,
    where: string,
    base: ContextBase,
    signal?: AbortSignal,
  ): InterceptorContext<O>
  release(ctx: InterceptorContext): void
  /** Number of free ctx objects held. */
  readonly size: number
}

/**
 * Ctx pool for hot ops (§3.4, §9.1). A free list rather than one shared object, so nested or
 * re-entrant runs of the same op never see each other's ctx. Bounded by `max`.
 */
export function createContextPool(max = 16): ContextPool {
  const free: ContextOf<OpName>[] = []
  return {
    acquire(op, input, where, base, signal) {
      const ctx = free.pop()
      if (!ctx) return createContext(op, input, where, base, signal)
      ctx.op = op
      ctx.input = input
      ctx.where = where
      ctx.table = base.table
      ctx.run = base.run
      ctx.trigger = base.trigger
      ctx.phase = base.phase
      ctx.emit = base.emit
      ctx.signal = signal
      return ctx as unknown as InterceptorContext<typeof op>
    },
    release(ctx) {
      if (free.length >= max) return
      const c = ctx as ContextOf<OpName>
      c.meta.clear()
      // Assigned, never deleted: `delete` changes the object shape (deopts the hot path). A free
      // ctx must not keep the table, its emitter or a signal alive.
      c.signal = undefined
      c.input = undefined
      c.table = undefined
      c.emit = released
      free.push(c)
    },
    get size() {
      return free.length
    },
  }
}
