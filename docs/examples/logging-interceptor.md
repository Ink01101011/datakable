# A logging and analytics interceptor

Everything a table does is an operation: a state change, a pipeline run, a fetch. An interceptor
wraps operations, the way middleware wraps requests, so you can measure or log them without
touching your table code.

## Goal

Send analytics events for what users do with a table (sort, search, page) and for slow pipeline
runs, and time every `fetcher` / `searchFn` request.

## The code

The interceptors:

```ts
import { defineInterceptor } from 'datakable'

/** Your analytics call, e.g. `posthog.capture` or `gtag('event', …)`. */
export type Track = (event: string, props: Record<string, string | number>) => void

// What users do: every state change made through the table's API (trigger `api:<method>`).
export const trackActions = (track: Track) =>
  defineInterceptor({
    name: 'analytics:actions',
    on: ['state:dispatch'],
    intercept(ctx, next) {
      if (ctx.trigger.startsWith('api:')) track('table_action', { action: ctx.trigger.slice(4) })
      return next()
    },
  })

// How fast it is: time every pipeline run (filter → search → sort → paginate), report slow ones.
export const reportSlowRuns = (track: Track, budgetMs = 16) =>
  defineInterceptor({
    name: 'analytics:slow-runs',
    on: ['pipeline:run'],
    intercept(ctx, next) {
      const start = performance.now()
      const result = next()
      const ms = performance.now() - start
      if (ms > budgetMs) {
        track('table_slow_run', { ms: Math.round(ms), rows: ctx.input.rowCount, by: ctx.trigger })
      }
      return result
    },
  })

// Request latency of a `fetcher` or `searchFn`: an async op, so `next()` is a promise.
export const timeRequests = (track: Track) =>
  defineInterceptor({
    name: 'analytics:requests',
    on: ['async:request'],
    async intercept(ctx, next) {
      const start = performance.now()
      try {
        return await next()
      } finally {
        track('table_request', {
          source: ctx.input.source,
          ms: Math.round(performance.now() - start),
        })
      }
    },
  })
```

Installing them:

```ts
import { createTable } from 'datakable'
import { reportSlowRuns, type Track, trackActions } from './1-analytics' // './analytics' in your app

type User = { id: number; name: string; age: number }

const users: User[] = [
  { id: 1, name: 'Mali', age: 31 },
  { id: 2, name: 'Anan', age: 25 },
]

export const events: [string, Record<string, string | number>][] = []
const track: Track = (event, props) => events.push([event, props])

// Interceptors wrap the table's operations; with useDataTable / <DataTable />, pass the same
// array as `interceptors` (define it outside the component).
const table = createTable({
  data: users,
  rowKey: 'id',
  interceptors: [trackActions(track), reportSlowRuns(track)],
})

table.toggleSort('age')
await table.setSearch('mal')
console.log(events) // [['table_action', { action: 'toggleSort' }], ['table_action', { action: 'setSearch' }]]
```

## What you will see

- One `table_action` event per user action, named after the table method: `toggleSort`,
  `setSearch`, `nextPage`, … (the install example records `toggleSort` and `setSearch`). State
  changes that do not come from an API call carry another trigger and are not tracked.
- A `table_slow_run` event when a pipeline run takes longer than the budget (16 ms, one frame),
  with the row count and what triggered it.
- With `timeRequests`, a `table_request` event per `fetcher` or `searchFn` request with its
  duration, also when the request fails or is aborted (`finally`).
- The table works the same: each interceptor calls `next()` and returns its result. One that
  throws is skipped for that call and reported as [`DK_INTERCEPTOR_FAILED`](../how-to-fix/errors.md#dk_interceptor_failed).

## Variations

- **Other operations:** `on` takes any of `table:init`, `table:setOptions`, `table:destroy`,
  `state:dispatch`, `data:ingest`, `pipeline:run`, `pipeline:step`, `async:request`,
  `diagnostic:emit`, or `'*'`. `column:batch` runs once per column per pipeline run and needs
  `hot: true` (else [`DK_HOT_INTERCEPTOR`](../how-to-fix/errors.md#dk_hot_interceptor) in development).
- **Per-step timings:** `pipeline:step` gives `ctx.input.feature` and `ctx.input.stage`, for a
  breakdown of where the time goes; `table.explain()` shows the same in development.
- **Rewrite or drop diagnostics:** an interceptor on `diagnostic:emit` receives
  `ctx.input.diagnostic` and can skip `next()` to drop it.
- **Ship it with a feature:** a feature's `interceptors` field installs them with the feature
  ([A custom feature](row-selection-feature.md)).

## See also

- [Diagnostics](../../packages/core/README.md#diagnostics) and
  [explain()](../../packages/core/README.md#explain-and-explainrow) in `@datakable/core`.
- [Error reporting](error-reporting.md) — `onDiagnostic` for problems rather than events.
- [Custom features and interceptors](../how-to-use/custom-features-and-interceptors.md) and
  [Diagnostics](../how-to-use/diagnostics.md) — the guides.
- [Examples](README.md)
