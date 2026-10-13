import { createTable, defineInterceptor } from 'datakable'

type User = { id: number; name: string }
declare const users: User[]

// Every diagnostic passes through `diagnostic:emit` (already redacted) before dedupe and sinks.
const quiet = defineInterceptor({
  name: 'quiet-info',
  on: ['diagnostic:emit'],
  intercept(ctx, next) {
    const d = ctx.input.diagnostic
    // Drop: do not call next(). The diagnostic reaches no sink and getDiagnostics().
    if (d.level === 'info') return undefined
    // Rewrite: change it before the sinks see it.
    d.fix = [...d.fix, 'Team guide: wiki/tables#diagnostics']
    return next()
  },
})

createTable({ data: users, rowKey: 'id', interceptors: [quiet] })
