import { createTable, defineInterceptor } from '@datakable/core'

// '*' includes column:batch, which runs once per column on every pipeline run.
const timing = defineInterceptor({
  name: 'timing',
  on: '*',
  intercept(ctx, next) {
    const start = performance.now()
    const out = next()
    console.debug(ctx.op, performance.now() - start)
    return out
  },
})

createTable({ data: [{ id: 1 }], interceptors: [timing] })
