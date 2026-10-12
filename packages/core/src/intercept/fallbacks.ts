import type { InterceptorContext } from './context'
import type { BuiltinOperations, OpName, OpResult } from './operations'

/**
 * What the errorBoundary returns when an op fails (§3.4 registry table). `describe` becomes the
 * diagnostic's `impact`.
 */
export interface Fallback<O extends OpName = OpName> {
  readonly describe: string
  /**
   * Report without the diagnostics pipeline: one `console.error` per table. Used by
   * `diagnostic:emit`, where reporting through the pipeline could recurse.
   */
  readonly silent?: boolean
  value(ctx: InterceptorContext<O>): OpResult<O>
}

/**
 * `ctx.meta` key for a caller-supplied fallback value: the previous data (`data:ingest`), the last
 * good row model (`pipeline:run`), the previous results (`async:request`). Set it before `run`.
 */
export const FALLBACK = 'datakable:fallback'

/**
 * `ctx.meta` key the errorBoundary sets (to the error) when it replaced the op's result with the
 * fallback, so the caller can tell a fallback from a real result (e.g. a failed `data:ingest` sets
 * `status: 'error'`, §6.6).
 */
export const FAILED = 'datakable:failed'

function allRows(n: number): Uint32Array {
  const out = new Uint32Array(n)
  for (let i = 0; i < n; i++) out[i] = i
  return out
}

const builtins: { [K in keyof BuiltinOperations]: Fallback<K> } = {
  'table:init': {
    describe: 'table creation continued without the failed step',
    value: () => undefined,
  },
  'table:setOptions': { describe: 'the previous options were kept', value: () => undefined },
  'table:destroy': {
    describe: 'teardown continued; the table is destroyed',
    value: () => undefined,
  },
  'state:dispatch': {
    describe: 'the update was dropped (state unchanged)',
    value: () => undefined,
  },
  'data:ingest': {
    describe: 'the previous data was kept',
    value: (ctx) => (ctx.meta.get(FALLBACK) as readonly unknown[] | undefined) ?? [],
  },
  'pipeline:run': {
    describe: 'the last good row model was kept',
    value: (ctx) =>
      (ctx.meta.get(FALLBACK) as Uint32Array | undefined) ?? allRows(ctx.input.rowCount),
  },
  'pipeline:step': {
    describe: 'the step passed its input through',
    value: (ctx) => ctx.input.indices,
  },
  'column:batch': {
    describe:
      "the column's cells use the slot fallback ('' for format, undefined for accessor, " +
      'non-matching for filterFn, missing (sorted last) for sortBy)',
    value: () => undefined,
  },
  'async:request': {
    describe: "the previous results were kept (status: 'error')",
    value: (ctx) => Promise.resolve(ctx.meta.get(FALLBACK)),
  },
  'diagnostic:emit': {
    describe: 'the diagnostic was dropped (the logger never kills the table)',
    silent: true,
    value: () => undefined,
  },
}

const NONE: Fallback = { describe: 'the operation returned undefined', value: () => undefined }

const registry = new Map<string, Fallback>(Object.entries(builtins) as [string, Fallback][])

/**
 * Sets the fallback of an op (ops registered by plugins / `@datakable/react`). Process-wide like
 * the op registry; the last registration wins.
 */
export function registerFallback<O extends OpName>(op: O, fallback: Fallback<O>): void {
  registry.set(op, fallback as unknown as Fallback)
}

/** The registered fallback, or one that returns `undefined` for ops without an entry. */
export function getFallback(op: string): Fallback {
  return registry.get(op) ?? NONE
}
