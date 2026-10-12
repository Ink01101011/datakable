import {
  CellFailures,
  createContextPool,
  createInterceptorRuntime,
  defineInterceptor,
  type InterceptorRuntime,
  runCells,
} from '@datakable/core'
import { describe, expect, it } from 'vitest'
import './measure' // NODE_ENV=production guard

// §9.3 "Boundary overhead per column batch vs raw loop ≤ +10%" (T37), on the built
// `@datakable/core` in production mode. The batch is the column cache's `column:batch` (§3.4,
// pipeline/column-cache.ts) built from the same public pieces: a pooled ctx, the interceptor
// runtime's compiled chain, `runCells` (inline try/catch per cell, failures recorded as numbers)
// and one `report` per column. The raw loop does the same cell work over the same row selection
// with none of it. `format` × 5 columns × 100k rows, as in §9.2.
//
// Timing: the variants run interleaved, ROUNDS times; each keeps its fastest round (the least
// disturbed by GC and the host), and the ratio of the fastest rounds is the overhead.

const N = 100_000
const COLUMNS = 5
const ROUNDS = 30
const BUDGET = 0.1

const data = Array.from({ length: N }, (_, i) => ({ id: i, price: (i * 31) % 5000 }))
const rows = Uint32Array.from({ length: N }, (_, i) => i)
const out: string[] = new Array(N).fill('')
const format = (r: { price: number }) => r.price.toFixed(2)
const emit = () => {}
const base = { table: undefined, run: 0, trigger: 'init' as const, phase: 'client' as const, emit }

function rawLoop() {
  for (let c = 0; c < COLUMNS; c++) {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] as number
      out[r] = format(data[r] as { price: number })
    }
  }
}

function batched(runtime: InterceptorRuntime) {
  const pool = createContextPool()
  const failures = new CellFailures()
  const cell = (r: number) => format(data[r] as { price: number })
  return () => {
    for (let c = 0; c < COLUMNS; c++) {
      const ctx = pool.acquire(
        'column:batch',
        { column: 'price', slot: 'format', rows },
        'columns[1].format',
        base,
      )
      try {
        void runtime.run('column:batch', ctx, (): undefined => {
          try {
            runCells(rows, cell, out, '', failures)
          } finally {
            failures.reset()
          }
        })
      } finally {
        pool.release(ctx)
      }
      failures.report(emit, 1, 'price', 'format')
    }
  }
}

const passThrough = defineInterceptor({
  name: 'pass',
  on: '*',
  hot: true,
  intercept: (_ctx, next) => next(),
})

function fastest(variants: Record<string, () => void>) {
  const best: Record<string, number> = {}
  for (let round = 0; round < ROUNDS; round++) {
    for (const [name, run] of Object.entries(variants)) {
      const t = performance.now()
      run()
      best[name] = Math.min(best[name] ?? Number.POSITIVE_INFINITY, performance.now() - t)
    }
  }
  return best
}

describe('§9.3 boundary overhead per column batch (format × 5 columns × 100k rows)', () => {
  it(`batch boundary vs raw loop ≤ +${BUDGET * 100}%`, () => {
    const best = fastest({
      raw: rawLoop,
      boundary: batched(createInterceptorRuntime()),
      'boundary + 1 interceptor': batched(
        createInterceptorRuntime({ interceptors: [passThrough] }),
      ),
    })
    const raw = best.raw as number
    const overhead = (best.boundary as number) / raw - 1
    const withInterceptor = (best['boundary + 1 interceptor'] as number) / raw - 1
    console.info(
      `[§9.3 batch] raw ${raw.toFixed(2)} ms, boundary ${best.boundary?.toFixed(2)} ms ` +
        `(${(overhead * 100).toFixed(1)}%), + 1 pass-through interceptor ` +
        `${best['boundary + 1 interceptor']?.toFixed(2)} ms (${(withInterceptor * 100).toFixed(1)}%)`,
    )
    expect(out[N - 1]).toBe(format(data[N - 1] as { price: number }))
    expect(overhead).toBeLessThanOrEqual(BUDGET)
  })
})
