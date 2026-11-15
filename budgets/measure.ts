// Measurement helpers for the §9.3 budget tests (T37). `process` is typed by hand (no
// @types/node in the workspace roots' type tests); the `node:` modules come with vitest's types.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Mem = { heapUsed: number; arrayBuffers: number }
const g = globalThis as unknown as {
  gc?: () => void
  process: {
    memoryUsage(): Mem
    env: Record<string, string | undefined>
    execPath: string
  }
}
const env = g.process.env

// The budgets are for the code a user ships: dev checks off (vitest.budgets.config.ts sets it).
if (env.NODE_ENV !== 'production') {
  throw new Error(`budgets run with NODE_ENV=production, got ${env.NODE_ENV}`)
}

export const MB = 1024 * 1024

/** Minimum full GCs per reading, then more until `arrayBuffers` stops changing (at most MAX). */
const MIN_GCS = 4
const MAX_GCS = 12

/**
 * Full GCs (`--expose-gc`, see the config) until the heap has settled; returns the last reading.
 *
 * A dead typed array's backing store is released by V8's concurrent array-buffer sweeper and only
 * leaves `memoryUsage().arrayBuffers` when a LATER collection finalizes that sweep: after two GCs a
 * dead `Float64Array(100k)` (0.76 MB) was still counted in some runs, after the third it never was
 * (#130: "sort name then city" read 3.96 or 4.74 MB between identical runs). So: at least
 * {@link MIN_GCS} collections, then more while `arrayBuffers` still changes.
 *
 */
export function fullGc(): Mem {
  if (typeof g.gc !== 'function') {
    throw new Error('globalThis.gc is missing: run under --expose-gc (vitest.budgets.config.ts)')
  }
  let last: Mem | undefined
  for (let i = 1; i <= MAX_GCS; i++) {
    g.gc()
    const m = g.process.memoryUsage()
    if (i >= MIN_GCS && last && m.arrayBuffers === last.arrayBuffers) return m
    last = m
  }
  return last as Mem
}

/** JS heap + typed-array backing stores once the heap has settled ({@link fullGc}). */
export function heapBytes(): number {
  const m = fullGc()
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

// --- Samples and medians (#130) -----------------------------------------------------------------

/** The tasks of one interaction ({@link trackTasks}). */
export type Tasks = ReturnType<ReturnType<typeof trackTasks>['result']>

/**
 * Samples per timing budget: odd, at least 5. A single run of the 100k string sort's longest task
 * read 39–56 ms between identical runs (#130); the median of independent samples is stable, and a
 * regression that lengthens a task lengthens it in every sample, so it still moves the median.
 */
export const SAMPLES = 5

/** Set in a sample's process: the file its results are written to. */
const SAMPLE_OUT = 'DK_BUDGET_SAMPLE_OUT'

/**
 * This process runs ONE sample for {@link sampled}: the test reports it and asserts no timing
 * (the parent asserts the median). Correctness checks still run, and fail the sample.
 */
export const IN_SAMPLE = env[SAMPLE_OUT] !== undefined

// A path, not `new URL()`: under happy-dom the global `URL` is not Node's.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vitestBin = (() => {
  const pkg = createRequire(import.meta.url).resolve('vitest/package.json')
  const bin = (JSON.parse(readFileSync(pkg, 'utf8')) as { bin: Record<string, string> }).bin
  return join(dirname(pkg), bin.vitest as string)
})()

/** The middle value (`xs.length` odd). */
export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[(s.length - 1) >> 1] as number
}

/** Set by vitest / vite in a test worker (`import.meta.env`); a child `vitest run` sets its own. */
const workerEnv = /^(VITEST.*|TEST|BASE_URL|MODE|DEV|PROD|SSR|FORCE_TTY|NODE_ENV)$/

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A timing budget measured as the median of {@link SAMPLES} samples, each in a FRESH process
 * (#130). The test `test` of `file` (relative to the repo root) is run alone, once per sample, by
 * a child `vitest run` of this config; there `sampled` runs `sample` once and reports it. So every
 * sample starts like a lone run of that test — no heap, JIT or cache state left by other tests or
 * by earlier samples — and is the same measurement as before, repeated.
 *
 * Returns, per interaction label, the median of each figure (longest task, response, total;
 * `tasks` / `yields` from the sample with the median longest task). Every sample is printed with
 * its median. In a sample's own process it returns that sample.
 */
export async function sampled<K extends string>(
  file: string,
  test: string,
  sample: () => Promise<Record<K, Tasks>>,
): Promise<Record<K, Tasks>> {
  const out = env[SAMPLE_OUT]
  if (out !== undefined) {
    const r = await sample()
    writeFileSync(out, JSON.stringify(r))
    return r
  }
  const dir = mkdtempSync(join(tmpdir(), 'dk-budget-'))
  const runs: Record<K, Tasks>[] = []
  try {
    // The child is a plain `vitest run`: none of the variables vitest / vite set in this worker.
    const base = Object.fromEntries(Object.entries(env).filter(([k]) => !workerEnv.test(k)))
    for (let i = 0; i < SAMPLES; i++) {
      const path = join(dir, `${i}.json`)
      const args = ['run', '--config', 'vitest.budgets.config.ts', file, '-t', escapeRegExp(test)]
      const child = spawnSync(g.process.execPath, [vitestBin, ...args], {
        cwd: root,
        env: { ...base, [SAMPLE_OUT]: path },
        encoding: 'utf8',
        maxBuffer: 64 * MB,
      })
      if (child.status !== 0 || !existsSync(path)) {
        const log = `${child.stdout ?? ''}${child.stderr ?? ''}`.split('\n').slice(-60).join('\n')
        throw new Error(
          `sample ${i + 1}/${SAMPLES} of "${test}" failed (exit ${child.status}):\n${log}`,
        )
      }
      runs.push(JSON.parse(readFileSync(path, 'utf8')) as Record<K, Tasks>)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  const result = {} as Record<K, Tasks>
  for (const label of Object.keys(runs[0] as object) as K[]) {
    const all = runs.map((r) => r[label])
    const longest = median(all.map((r) => r.longest))
    const mid = all.find((r) => r.longest === longest) as Tasks
    const r: Tasks = {
      tasks: mid.tasks,
      yields: mid.yields,
      longest,
      first: median(all.map((x) => x.first)),
      total: median(all.map((x) => x.total)),
    }
    result[label] = r
    const list = (pick: (x: Tasks) => number) => all.map((x) => pick(x).toFixed(1)).join(', ')
    console.info(
      `[§9.3 4x] ${label}: median of ${SAMPLES} processes: longest task ${longest.toFixed(1)} ms ` +
        `[${list((x) => x.longest)}], response ${r.first.toFixed(1)} ms [${list((x) => x.first)}], ` +
        `total ${r.total.toFixed(1)} ms [${list((x) => x.total)}]`,
    )
  }
  return result
}
