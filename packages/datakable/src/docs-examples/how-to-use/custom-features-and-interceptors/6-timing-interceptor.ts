import {
  createTable,
  defineInterceptor,
  type FetchResult,
  pagination,
  withFetcher,
} from 'datakable'

type User = { id: number; name: string }
declare function report(metric: string, ms: number, extra: object): void

// A sync op: next() returns the result itself, and so must the interceptor.
const pipelineTiming = defineInterceptor({
  name: 'pipeline-timing',
  on: ['pipeline:run'],
  intercept(ctx, next) {
    const start = performance.now()
    try {
      return next()
    } finally {
      report('pipeline', performance.now() - start, { rows: ctx.input.rowCount, run: ctx.run })
    }
  },
})

// An async op: next() returns a Promise, and the interceptor must return one.
const requestTiming = defineInterceptor({
  name: 'request-timing',
  on: ['async:request'],
  async intercept(ctx, next) {
    const start = performance.now()
    try {
      return await next()
    } finally {
      report('request', performance.now() - start, { source: ctx.input.source })
    }
  },
})

createTable({
  rowKey: 'id',
  features: [pagination({ mode: 'server' })],
  fetcher: withFetcher(
    async ({ pageIndex, signal }) =>
      (await (await fetch(`/api/users?page=${pageIndex}`, { signal })).json()) as FetchResult<User>,
  ),
  interceptors: [pipelineTiming, requestTiming],
})
