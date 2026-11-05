// @vitest-environment happy-dom
import { createDefaultFeatures, createTable } from '@datakable/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { throttleClock, trackTasks } from './measure'
import { mixedUsers } from './mixed-users'

// §9.3 interaction budgets under a 4x CPU throttle (T37), on the built `@datakable/core` in
// production mode, in a browser phase (happy-dom: `document` exists, so the table time-slices
// after its first row model, §9.1 — unlike the Node core suite, which runs as SSR).
//
// Throttle: `throttleClock(4)` makes `performance.now()` run 4x faster than the real clock, so the
// slicer's deadlines and every task measured here are what a 4x slower CPU shows (measure.ts).
// Tasks are delimited the way T29 measured them: from the input (or a resumed slice) to the next
// `scheduler.yield()` or to the commit of the result.
//
// Budgets:
// - "Longest task while building the projection for 100k rows ≤ 50 ms": enforced (first query).
//   String sorts at 100k (sliced collation ranks) are held to the same 50 ms.
// - "Interaction (type / sort / page) on 10k rows, client mode, CPU throttle 4x < 100 ms":
//   enforced as the response — the input's own task, after which the table shows the result or
//   `pending` (the INP view of an interaction). The CPU time until the result is applied
//   (`total`) is printed next to it and compared with 100 ms; it is not asserted: it depends on
//   the host's speed and is close to 100 ms for a first string sort (reported to the user).

const THROTTLE = 4
const LONG_TASK_MS = 50
const INTERACTION_MS = 100

// Wall-clock budgets are enforced on the maintainer's machine (the release gate is the local
// `pnpm check:budgets`). Shared CI runners (GitHub sets CI=true) are several times slower and
// noisy, so there the timings are printed, not asserted; size, memory and batch budgets still are.
const ENFORCE_TIMING = process.env.CI !== 'true'
function withinMs(actual: number, limit: number, label: string, strictlyBelow = false) {
  const ok = strictlyBelow ? actual < limit : actual <= limit
  if (ENFORCE_TIMING) {
    if (strictlyBelow) expect.soft(actual, label).toBeLessThan(limit)
    else expect(actual, label).toBeLessThanOrEqual(limit)
  } else if (!ok) {
    console.warn(`[§9.3 4x, CI: not enforced] ${label}: ${actual.toFixed(1)} ms > ${limit} ms`)
  }
}

type P = { id: number; age: number; name: string; city: string }
const cities = ['Bangkok', 'Chiang Mai', 'Khon Kaen', 'Phuket', 'Udon Thani']
const people = (n: number): P[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i,
    age: (i * 7919) % 100,
    name: `name ${(i * 2654435761) % n}`,
    city: cities[i % cities.length] as string,
  }))

let clock: ReturnType<typeof throttleClock>
let tracker: ReturnType<typeof trackTasks>

beforeAll(() => {
  clock = throttleClock(THROTTLE)
  tracker = trackTasks(clock.now)
})
afterAll(() => {
  tracker.restore()
  clock.restore()
})

function table(n: number) {
  const t = createTable({
    data: people(n),
    rowKey: 'id',
    features: createDefaultFeatures(),
    onDiagnostic() {},
  })
  t.getRowModel() // the first row model is never sliced (hydration parity)
  return t
}
/** What {@link interact} drives: any table with search, whatever its row type. */
type T = {
  getRowModel(): { readonly status: string }
  subscribe(listener: () => void): () => void
  setSearch(query: string): Promise<unknown>
  flushSearch(): Promise<unknown>
}

/** Runs one interaction to completion; its tasks (throttled ms). */
async function interact(t: T, label: string, act: () => void) {
  tracker.reset()
  let acting = true
  let settle = () => {}
  const settled = new Promise<void>((resolve) => {
    settle = resolve
  })
  const unsubscribe = t.subscribe(() => {
    if (acting) return // notified inside the input's own task
    const m = t.getRowModel() // commit, as React reads it
    tracker.end()
    if (m.status === 'idle') settle()
  })
  tracker.start()
  act()
  const status = t.getRowModel().status
  tracker.end()
  acting = false
  if (status !== 'idle') await settled
  unsubscribe()
  expect(t.getRowModel().status).toBe('idle')
  const r = tracker.result()
  console.info(
    `[§9.3 4x] ${label}: response ${r.first.toFixed(1)} ms, longest task ${r.longest.toFixed(1)} ms, ` +
      `total ${r.total.toFixed(1)} ms (${r.tasks} tasks, ${r.yields} yields)`,
  )
  return r
}

const type = (t: T, q: string) => () => {
  void t.setSearch(q)
  void t.flushSearch()
}

describe(`§9.3 interaction on 10k rows, client mode, CPU throttle ${THROTTLE}x`, () => {
  // Each kind on a fresh table of all 10k rows (cold caches: the first sort / query pays for the
  // column cache, the projection or the collation ranks).
  it(`type / sort / page respond in < ${INTERACTION_MS} ms`, async () => {
    const typing = table(10_000)
    const sorted = table(10_000)
    const numeric = table(10_000)
    const paged = table(10_000)
    const runs = {
      'type (first query)': await interact(
        typing,
        '10k type, first query',
        type(typing, 'name 12'),
      ),
      'type (next query)': await interact(typing, '10k type, next query', type(typing, 'name 123')),
      'sort (string, first)': await interact(sorted, '10k sort name', () =>
        sorted.toggleSort('name'),
      ),
      'sort (string, again)': await interact(sorted, '10k sort name desc', () =>
        sorted.toggleSort('name'),
      ),
      'sort (number)': await interact(numeric, '10k sort age', () => numeric.toggleSort('age')),
      page: await interact(paged, '10k next page', () => paged.nextPage()),
    }
    for (const [label, r] of Object.entries(runs)) {
      withinMs(r.first, INTERACTION_MS, label, true)
      if (r.total >= INTERACTION_MS) {
        console.info(
          `[§9.3 4x] 10k ${label}: total ${r.total.toFixed(1)} ms ≥ ${INTERACTION_MS} ms`,
        )
      }
    }
    expect(typing.getState().search.query).toBe('name 123')
    expect(sorted.getSortDirection('name')).toBe('desc')
    expect(paged.getState().pagination.pageIndex).toBe(1)
  })
})

describe(`§9.3 longest task at 100k rows, CPU throttle ${THROTTLE}x (browser phase)`, () => {
  it(`building the search projection: every task ≤ ${LONG_TASK_MS} ms (time-sliced)`, async () => {
    const t = table(100_000)
    const first = await interact(t, '100k type, first query (projection)', type(t, 'name 12'))
    // Sliced: the work ran in several tasks between scheduler.yield() calls.
    expect(first.yields).toBeGreaterThan(0)
    withinMs(first.longest, LONG_TASK_MS, 'first query longest task')
    const next = await interact(t, '100k type, next query', type(t, 'name 123'))
    withinMs(next.longest, LONG_TASK_MS, 'next query longest task')
    expect(t.getRowModel().filteredCount).toBeGreaterThan(0)
  })

  it(`building the projection over mixed zero-config columns: every task ≤ ${LONG_TASK_MS} ms (#40)`, async () => {
    // Dates, arrays, nullable numbers: the per-column formatting is sliced too, not one task each.
    const t = createTable({
      data: mixedUsers(100_000),
      rowKey: 'id',
      features: createDefaultFeatures(),
      onDiagnostic() {},
    })
    t.getRowModel()
    const first = await interact(t, '100k mixed type, first query (projection)', type(t, 'bangkok'))
    expect(first.yields).toBeGreaterThan(0)
    withinMs(first.longest, LONG_TASK_MS, 'first query longest task')
    const next = await interact(t, '100k mixed type, next query', type(t, 'zürich'))
    withinMs(next.longest, LONG_TASK_MS, 'next query longest task')
    expect(t.getRowModel().filteredCount).toBeGreaterThan(0)
  })

  it(`sorting a string column (collation ranks): every task ≤ ${LONG_TASK_MS} ms`, async () => {
    const t = table(100_000)
    const r = await interact(t, '100k sort name', () => t.toggleSort('name'))
    expect(r.yields).toBeGreaterThan(0)
    withinMs(r.longest, LONG_TASK_MS, 'string sort longest task')
    const names = t.getRowModel().rows.map((row) => row.original.name)
    expect(names).toEqual([...names].sort(new Intl.Collator(undefined, { numeric: true }).compare))
  })
})
