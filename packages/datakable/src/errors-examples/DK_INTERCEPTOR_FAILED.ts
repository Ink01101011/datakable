import { createTable, defineInterceptor, sorting } from '@datakable/core'

declare const analytics: { track(event: string): void } | undefined // not loaded yet

const tracking = defineInterceptor({
  name: 'tracking',
  on: ['state:dispatch'],
  intercept(ctx, next) {
    ;(analytics as { track(event: string): void }).track(ctx.op) // throws while undefined
    return next()
  },
})

const table = createTable({
  data: [{ id: 1, name: 'Ada' }],
  features: [sorting()],
  interceptors: [tracking],
})
table.toggleSort('name') // still sorts: the interceptor is skipped
