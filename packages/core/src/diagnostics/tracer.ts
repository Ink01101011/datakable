import type { Interceptor } from '../intercept/define'
import { readTrace, type Trace, writeTrace } from './trace-store'

type Traced = 'pipeline:run' | 'pipeline:step' | 'state:dispatch'

const now = (): number =>
  typeof performance === 'object' && typeof performance?.now === 'function'
    ? performance.now()
    : Date.now()

/** Set on the ctx by the first tracer of a chain: a second one (user + built-in) only passes on. */
const SEEN = 'tracer'

/**
 * The `tracer` interceptor (§3.4): timings and per-step counts of the last pipeline run, read by
 * `table.explain()`. `createTable` installs it in development; in production it is off (§8.2) and
 * opt-in with `createTable({ interceptors: [tracer()] })`. Keeps the last run only: counts, never
 * rows.
 */
export function tracer(): Interceptor<Traced> {
  return {
    name: 'tracer',
    on: ['pipeline:run', 'pipeline:step', 'state:dispatch'],
    intercept(ctx, next) {
      const table = ctx.table
      if (ctx.meta.has(SEEN) || typeof table !== 'object' || table === null) return next()
      ctx.meta.set(SEEN, true)
      const start = now()
      if (ctx.op === 'pipeline:run') {
        const trace: Trace = {
          run: ctx.run,
          trigger: ctx.trigger,
          ms: undefined,
          steps: new Map(),
          dispatch: readTrace(table)?.dispatch,
        }
        writeTrace(table, trace)
        try {
          return next()
        } finally {
          trace.ms = now() - start
        }
      }
      if (ctx.op === 'pipeline:step') {
        const out = next() as Uint32Array
        const trace = readTrace(table)
        if (trace?.run === ctx.run) {
          trace.steps.set(ctx.input.feature, {
            input: ctx.input.indices.length,
            output: out.length,
            ms: now() - start,
          })
        }
        return out
      }
      try {
        return next()
      } finally {
        const dispatch = { where: ctx.where, ms: now() - start }
        const trace = readTrace(table)
        // Before the first (lazy) run: kept on an empty trace until a run carries it over.
        if (trace) trace.dispatch = dispatch
        else {
          writeTrace(table, {
            run: ctx.run,
            trigger: ctx.trigger,
            ms: undefined,
            steps: new Map(),
            dispatch,
          })
        }
      }
    },
  } as Interceptor<Traced>
}
