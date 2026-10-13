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
