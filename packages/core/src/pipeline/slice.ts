import { keepDiagnostics } from '../diagnostics/catalog'
import type { Emit, Trigger } from '../diagnostics/types'
import { envDiagnostics } from './env-codes'

keepDiagnostics(envDiagnostics)

/**
 * Time-sliced work (§9.1): a generator that `yield`s between chunks of work (every few thousand
 * rows). Its return value is the result.
 */
export type SliceJob<R> = () => Iterator<unknown, R, undefined>

/**
 * One slice of work, in milliseconds. A job that finishes within it never goes async (small
 * tables keep synchronous row models); the slices of a longer one stay well under the 50 ms
 * long-task budget (§9.3) with the rest of the pipeline run around them.
 */
export const SLICE_MS = 8

export interface SlicerHost {
  readonly emit: Emit
  /** Slicing is allowed now: in the browser, after the table's first row model. */
  enabled(): boolean
  /** The trigger of the current run (a finished job recomputes under it). */
  trigger(): Trigger
  /** A job ended (its result or error is ready): recompute the row model and notify. */
  done(trigger: Trigger): void
  /** A slice run between pipeline runs took `ms` (the tracer's, #61). */
  timed?(feature: string, ms: number): void
}

export interface Slicer {
  /**
   * The result of the job for `key`: started on the first call (one synchronous slice), then
   * `undefined` until it has finished. A job that threw rethrows here, in the step that asks.
   */
  run<R>(key: object, job: SliceJob<R>, feature: string): R | undefined
  /** Starts a pipeline run: jobs that no step asks for until {@link end} are cancelled. */
  begin(): void
  end(): void
  /** Cancels every job (`destroy()`). */
  cancel(): void
}

/** Runs `job` to completion (no slicing). */
export function runJob<R>(job: SliceJob<R>): R {
  const it = job()
  for (;;) {
    const r = it.next()
    if (r.done) return r.value
  }
}

/**
 * `ctx.slice(key, job)` where the runner provides it (a table run), else the whole job now. For
 * features: `undefined` means "still running" (return a stand-in).
 */
export function sliced<R>(
  ctx: { slice?: <X>(key: object, job: SliceJob<X>) => X | undefined },
  key: object,
  job: SliceJob<R>,
): R | undefined {
  return ctx.slice ? ctx.slice(key, job) : runJob(job)
}

interface Task {
  readonly key: object
  readonly it: Iterator<unknown, unknown, undefined>
  readonly trigger: Trigger
  readonly feature: string
  state: 'running' | 'done' | 'failed' | 'cancelled'
  value: unknown
}

const now = (): number =>
  typeof performance === 'object' && typeof performance?.now === 'function'
    ? performance.now()
    : Date.now()

type Scheduler = { yield?: () => Promise<void> }

/** Runs `task` until it ends or `deadline` passes (checked at each `yield`). */
function advance(task: Task, deadline: number) {
  try {
    for (;;) {
      const r = task.it.next()
      if (r.done) {
        task.state = 'done'
        task.value = r.value
        return
      }
      if (now() >= deadline) return
    }
  } catch (e) {
    task.state = 'failed'
    task.value = e
  }
}

/**
 * The table's slicer (§9.1). Between slices it yields to the main thread with
 * `scheduler.yield()`, or `setTimeout` where that is missing (`DK_ENV_FALLBACK`, once per table).
 * Jobs are keyed by an object of the caller (e.g. the data / columns they read), so a job is
 * started once and its result is shared by later runs.
 */
export function createSlicer(host: SlicerHost): Slicer {
  const tasks = new WeakMap<object, Task>()
  const running = new Set<Task>()
  let asked: Set<Task> | undefined
  let reported = false

  function pause(feature: string): Promise<void> {
    const s = (globalThis as { scheduler?: Scheduler }).scheduler
    if (typeof s?.yield === 'function') return s.yield()
    if (!reported) {
      reported = true
      host.emit('DK_ENV_FALLBACK', { api: 'scheduler.yield', feature, fallback: 'setTimeout' })
    }
    return new Promise((resolve) => setTimeout(resolve, 0))
  }

  async function drive(task: Task) {
    while (task.state === 'running') {
      await pause(task.feature)
      if (task.state !== 'running') return
      const start = now()
      advance(task, start + SLICE_MS)
      host.timed?.(task.feature, now() - start)
    }
    running.delete(task)
    host.done(task.trigger)
  }

  function result(task: Task): unknown {
    if (task.state === 'failed') throw task.value
    return task.state === 'done' ? task.value : undefined
  }

  return {
    run<R>(key: object, job: SliceJob<R>, feature: string): R | undefined {
      const known = tasks.get(key)
      if (known && known.state !== 'cancelled') {
        asked?.add(known)
        return result(known) as R | undefined
      }
      const task: Task = {
        key,
        it: job(),
        trigger: host.trigger(),
        feature,
        state: 'running',
        value: undefined,
      }
      tasks.set(key, task)
      advance(task, host.enabled() ? now() + SLICE_MS : Number.POSITIVE_INFINITY)
      if (task.state === 'running') {
        running.add(task)
        asked?.add(task)
        // `drive` never rejects: `advance` catches the job's errors, `done` is the table's.
        void drive(task).catch(() => {})
      }
      return result(task) as R | undefined
    },
    begin() {
      asked = new Set()
    },
    end() {
      const keep = asked
      asked = undefined
      if (!keep) return
      for (const task of running) {
        if (keep.has(task)) continue
        task.state = 'cancelled'
        running.delete(task)
        tasks.delete(task.key)
      }
    },
    cancel() {
      for (const task of running) {
        task.state = 'cancelled'
        tasks.delete(task.key)
      }
      running.clear()
    },
  }
}
