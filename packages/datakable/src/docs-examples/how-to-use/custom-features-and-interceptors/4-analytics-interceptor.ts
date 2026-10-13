import { createTable, defineInterceptor } from 'datakable'

type User = { id: number; name: string; age: number }
declare const users: User[]
declare function track(event: string, props: object): void

// After every committed state change: which method changed what (sync op, sync next()).
const analytics = defineInterceptor({
  name: 'analytics',
  on: ['state:dispatch'],
  intercept(ctx, next) {
    const out = next()
    // ctx.trigger: 'api:toggleSort', 'api:setState', …; ctx.where: the feature or 'setState'.
    track('table-state', { trigger: ctx.trigger, slice: ctx.where, run: ctx.run })
    return out
  },
})

const table = createTable({ data: users, rowKey: 'id', interceptors: [analytics] })
table.toggleSort('age') // track('table-state', { trigger: 'api:toggleSort', slice: 'sorting', … })
