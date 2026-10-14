import type { ContextBase } from '../intercept/context'
import type { Interceptor } from '../intercept/define'
import { perfDiagnostics } from '../pipeline/perf-codes'
import { keepDiagnostics } from './catalog'
import { readTrace, SLICED, sliceTimer, type Trace, writeTrace } from './trace-store'
import type { Emit } from './types'

/**
 * The longest a single step may take (ms): §9.3's longest-task budget. A traced step over it
 * reports `DK_PERF_HINT` (§8.3) with its numbers.
 */
export const STEP_BUDGET_MS = 50

type Traced = 'pipeline:run' | 'pipeline:step' | 'state:dispatch' | 'column:batch'

const now = (): number =>
  typeof performance === 'object' && typeof performance?.now === 'function'
    ? performance.now()
    : Date.now()

/** Set on the ctx by the first tracer of a chain: a second one (user + built-in) only passes on. */
const SEEN = 'tracer'

/**
 * Per table, across runs (#61): a step waiting on time-sliced work, by feature: its stage, the
 * time of its runs so far plus the slices since, and how many runs. The run that gets the result
 * adds its own time and shows the total.
 */
type Job = { stage: string; ms: number; runs: number }

/**
 * Per table: its steps waiting on sliced work, and the time of each `column:batch` slot
 * (`columns[0].format` → column id, ms) since the current step or slice began (#62).
 */
type Work = { jobs: Map<string, Job>; slots: Map<string, [string, number]> }
const work = new WeakMap<object, Work>()

function workOf(table: object): Work {
  let w = work.get(table)
  if (!w) {
    w = { jobs: new Map(), slots: new Map() }
    work.set(table, w)
  }
  return w
}

/** DK_PERF_HINT for a task over the budget, with the slot most of its time went to (#62). */
function hint(
  emit: Emit,
  w: Work,
  feature: string,
  stage: string,
  ms: number,
  rows: number,
  sliced: boolean,
) {
  let slot: string | undefined
  let top: [string, number] = ['', 0]
  for (const [where, t] of w.slots) {
    if (t[1] > top[1]) {
      slot = where
      top = t
    }
  }
  w.slots.clear()
  if (ms <= STEP_BUDGET_MS) return
  emit('DK_PERF_HINT', {
    feature,
    stage,
    ms,
    rows,
    budget: STEP_BUDGET_MS,
    ...(sliced ? { sliced } : {}),
    // Named when it took at least half of the time.
    ...(slot && top[1] * 2 >= ms ? { slot, column: top[0], share: Math.min(1, top[1] / ms) } : {}),
  })
}

/** A slice of time-sliced work, run between pipeline runs (#61): its own task. */
function onSlice(base: ContextBase, feature: string, ms: number) {
  const table = base.table as object
  const trace = readTrace(table)
  // Only for tables this tracer (or another) traces.
  if (!trace) return
  const w = workOf(table)
  const job = w.jobs.get(feature)
  if (job) job.ms += ms
  hint(base.emit, w, feature, job?.stage ?? '', ms, trace.steps.get(feature)?.input ?? 0, true)
}

/**
 * The `tracer` interceptor (§3.4): timings and per-step counts of the last pipeline run, read by
 * `table.explain()`. `createTable` installs it in development; in production it is off (§8.2) and
 * opt-in with `createTable({ interceptors: [tracer()] })`. Keeps the last run only: counts, never
 * rows. Time-sliced work (§9.1) is added to the step that waited on it (#61).
 */
export function tracer(): Interceptor<Traced> {
  // Inside the factory: a bundle that never creates a tracer drops the definition (§9.1).
  keepDiagnostics(perfDiagnostics)
  sliceTimer.current = onSlice
  return {
    name: 'tracer',
    on: ['pipeline:run', 'pipeline:step', 'state:dispatch', 'column:batch'],
    // column:batch: one timing per batch of a column, never per cell (§3.4).
    hot: true,
    intercept(ctx, next) {
      const table = ctx.table
      if (ctx.meta.has(SEEN) || typeof table !== 'object' || table === null) return next()
      ctx.meta.set(SEEN, true)
      const start = now()
      if (ctx.op === 'column:batch') {
        try {
          return next()
        } finally {
          const slots = workOf(table).slots
          const t = slots.get(ctx.where)
          const ms = now() - start
          if (t) t[1] += ms
          else slots.set(ctx.where, [ctx.input.column, ms])
        }
      }
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
        const w = workOf(table)
        w.slots.clear()
        const out = next() as Uint32Array
        const own = now() - start
        const { feature, stage, indices } = ctx.input
        const pending = w.jobs
        const job = pending.get(feature)
        let ms = own
        let runs: number | undefined
        if (ctx.meta.has(SLICED)) {
          // Its result comes in a later run: that run shows the total.
          pending.set(feature, { stage, ms: (job?.ms ?? 0) + own, runs: (job?.runs ?? 0) + 1 })
        } else if (job) {
          pending.delete(feature)
          ms += job.ms
          runs = job.runs + 1
        }
        const trace = readTrace(table)
        if (trace?.run === ctx.run) {
          trace.steps.set(feature, {
            input: indices.length,
            output: out.length,
            ms,
            ...(runs ? { runs } : {}),
          })
        }
        // One task: the step's own time.
        hint(ctx.emit, w, feature, stage, own, indices.length, false)
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
