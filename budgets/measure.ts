// Measurement helpers for the §9.3 budget tests (T37). Node built-ins are typed by hand (no
// @types/node in the workspace roots' type tests).

type Mem = { heapUsed: number; arrayBuffers: number }
const g = globalThis as unknown as {
  gc?: () => void
  process: { memoryUsage(): Mem; env: { NODE_ENV?: string } }
}

// The budgets are for the code a user ships: dev checks off (vitest.budgets.config.ts sets it).
if (g.process.env.NODE_ENV !== 'production') {
  throw new Error(`budgets run with NODE_ENV=production, got ${g.process.env.NODE_ENV}`)
}

export const MB = 1024 * 1024

/** JS heap + typed-array backing stores after two full GCs (`--expose-gc`, see the config). */
export function heapBytes(): number {
  if (typeof g.gc !== 'function') {
    throw new Error('globalThis.gc is missing: run under --expose-gc (vitest.budgets.config.ts)')
  }
  g.gc()
  g.gc()
  const m = g.process.memoryUsage()
  return m.heapUsed + m.arrayBuffers
}

/** The memory `build()` adds and keeps (its result is held until after the second reading). */
export function measureHeap<V>(build: () => Promise<V>): Promise<{ mb: number; value: V }>
export function measureHeap<V>(build: () => V): { mb: number; value: V }
export function measureHeap<V>(
  build: () => V | Promise<V>,
): { mb: number; value: V } | Promise<{ mb: number; value: V }> {
  const before = heapBytes()
  const value = build()
  const done = (v: V) => ({ mb: (heapBytes() - before) / MB, value: v })
  return value instanceof Promise ? value.then(done) : done(value)
}

// --- CPU throttling and long tasks --------------------------------------------------------------

/**
 * 4x CPU throttling, emulated in Node (Node has no CPU throttle): `performance.now()` runs FACTOR
 * times faster than the real clock. Every duration DataKable or this file reads is then what a CPU
 * FACTOR times slower would show — the slicer's 8 ms deadlines end after 2 ms of real work, i.e.
 * after the same amount of work a 4x slower CPU does in 8 ms, and a task measured at 20 ms here is
 * 5 ms of real work. Only time spent running JavaScript is counted (tasks below); idle waits
 * between tasks are not interaction cost. The real speed of the host still matters: this is 4x
 * the machine running the test, like DevTools' throttle is 4x the developer's machine.
 */
export function throttleClock(factor: number) {
  const perf = globalThis.performance
  const real = perf.now.bind(perf)
  const t0 = real()
  const now = () => t0 + factor * (real() - t0)
  const desc = Object.getOwnPropertyDescriptor(perf, 'now')
  Object.defineProperty(perf, 'now', { value: now, configurable: true, writable: true })
  return {
    now,
    restore() {
      if (desc) Object.defineProperty(perf, 'now', desc)
      else delete (perf as { now?: unknown }).now
    },
  }
}

/**
 * Main-thread tasks, the way T29 measured them: a task runs from an input handler (or a resumed
 * slice) to the next yield (`scheduler.yield()`, installed here like Chrome's) or to the commit of
 * the result (the table's listener reading the row model, as React does). The longest task is the
 * long-task budget; the sum of the tasks is the CPU cost of an interaction.
 */
export function trackTasks(now: () => number) {
  let tasks: number[] = []
  let open: number | undefined
  let yields = 0
  const start = () => {
    open = now()
  }
  const end = () => {
    if (open === undefined) return
    tasks.push(now() - open)
    open = undefined
  }
  const s = globalThis as { scheduler?: unknown }
  const had = Object.hasOwn(s, 'scheduler')
  const previous = s.scheduler
  s.scheduler = {
    yield(): Promise<void> {
      yields++
      end()
      return new Promise((resolve) =>
        setTimeout(() => {
          start()
          resolve()
        }, 0),
      )
    },
  }
  return {
    start,
    end,
    reset() {
      tasks = []
      open = undefined
      yields = 0
    },
    result() {
      return {
        tasks: tasks.length,
        yields,
        longest: tasks.reduce((a, b) => Math.max(a, b), 0),
        total: tasks.reduce((a, b) => a + b, 0),
        first: tasks[0] ?? 0,
      }
    },
    restore() {
      if (had) s.scheduler = previous
      else delete s.scheduler
    },
  }
}
