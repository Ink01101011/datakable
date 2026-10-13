// Overhead of a compiled interceptor chain vs a direct call (spec §3.4, §9.2).
// Run: pnpm vitest bench --run --project core packages/core/src/intercept/chain.bench.ts
import { test } from 'vitest'
import { type ContextBase, createContext, createContextPool } from './context'
import { defineInterceptor } from './define'
import { createInterceptorRuntime } from './runtime'

const base: ContextBase = {
  table: undefined,
  run: 0,
  trigger: 'init',
  phase: 'client',
  emit: () => {},
}
const passAll = defineInterceptor({ name: 'pass', on: '*', hot: true, intercept: (_c, n) => n() })
const empty = createInterceptorRuntime()
const one = createInterceptorRuntime({ interceptors: [passAll] })

// --- cold op: 1M pipeline:step calls with a trivial core and a reused ctx
const N = 1_000_000
const indices = new Uint32Array([3, 1, 2])
const stepCtx = createContext(
  'pipeline:step',
  { stage: 'sort', feature: 'sorting', indices },
  'features.sorting',
  base,
)
const step = (ctx: typeof stepCtx) => ctx.input.indices
let sink: unknown

test('cold op (pipeline:step) × 1M', async ({ bench }) => {
  await bench.compare(
    bench('direct call', () => {
      for (let k = 0; k < N; k++) sink = step(stepCtx)
    }),
    bench('compiled empty chain', () => {
      for (let k = 0; k < N; k++) sink = empty.run('pipeline:step', stepCtx, step)
    }),
    bench('compiled chain, 1 pass-through interceptor', () => {
      for (let k = 0; k < N; k++) sink = one.run('pipeline:step', stepCtx, step)
    }),
  )
})

// --- hot op: column:batch = one call per column per run; format() over 100k rows × 5 columns
const ROWS = 100_000
const rows = Array.from({ length: ROWS }, (_, i) => ({ id: i, price: (i * 31) % 5000 }))
const noRow = { id: -1, price: 0 }
const all = Uint32Array.from({ length: ROWS }, (_, i) => i)
const out = new Array<string>(ROWS)
const format = (r: { price: number }) => r.price.toFixed(2)
const batchLoop = (sel: Uint32Array) => {
  let k = 0
  for (const i of sel) {
    try {
      out[k] = format(rows[i] ?? noRow)
    } catch {
      out[k] = ''
    }
    k++
  }
}
const pool = createContextPool()

test('hot op (column:batch) × 5 columns × 100k rows', async ({ bench }) => {
  await bench.compare(
    bench('direct loop', () => {
      for (let c = 0; c < 5; c++) batchLoop(all)
    }),
    bench('compiled empty chain + pooled ctx', () => {
      for (let c = 0; c < 5; c++) {
        const ctx = pool.acquire(
          'column:batch',
          { column: 'price', slot: 'format', rows: all },
          'f',
          base,
        )
        empty.run('column:batch', ctx, (x) => {
          batchLoop(x.input.rows)
        })
        pool.release(ctx)
      }
    }),
    bench('compiled chain, 1 pass-through interceptor + pooled ctx', () => {
      for (let c = 0; c < 5; c++) {
        const ctx = pool.acquire(
          'column:batch',
          { column: 'price', slot: 'format', rows: all },
          'f',
          base,
        )
        one.run('column:batch', ctx, (x) => {
          batchLoop(x.input.rows)
        })
        pool.release(ctx)
      }
    }),
  )
})

export { sink }
