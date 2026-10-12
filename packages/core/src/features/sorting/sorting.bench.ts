// `sort auto` selection overhead at n ≤ 1k vs a direct native call (spec §6.4, §9.3).
// Run: pnpm vitest bench --run --project core packages/core/src/features/sorting/sorting.bench.ts
import { test } from 'vitest'
import type { RowModelContext } from '../../feature/types'
import { defaultIndexComparator } from './compare'
import { sorting } from './sorting'

const collator = new Intl.Collator(undefined, { numeric: true })

/** A RowModelContext over one column `a` (values as the column cache would hold them). */
function context(values: Float64Array | unknown[]): RowModelContext {
  const data = Array.from({ length: values.length }, (_, i) => ({ a: values[i] }))
  return {
    name: 'sorting',
    data,
    emit: () => undefined,
    run: 0,
    columns: [{ key: 'a' }],
    getColumnValues: () => values,
    getFormattedValues: () => undefined,
    batch: () => true,
  }
}

const auto = sorting()
const native = sorting({ algorithm: 'native' })
const state = { by: [{ id: 'a', desc: false }] }

for (const n of [100, 1000]) {
  const indices = new Uint32Array(n).map((_, i) => i)
  const ints = new Float64Array(n).map((_, i) => (i * 2654435761) % (n * 100))
  const strings = Array.from({ length: n }, (_, i) => `name ${(i * 2654435761) % n}`)
  for (const [kind, values] of [
    ['int keys', ints],
    ['strings', strings],
  ] as const) {
    const ctx = context(values)
    const cmp = defaultIndexComparator(values, false, collator)
    test(`${kind}, n = ${n}`, async ({ bench }) => {
      await bench.compare(
        bench('direct native call', () => {
          indices.slice().sort(cmp)
        }),
        bench("sorting({ algorithm: 'native' })", () => {
          native.rowModel?.(indices, state, ctx)
        }),
        bench("sorting() — 'auto'", () => {
          auto.rowModel?.(indices, state, ctx)
        }),
      )
    })
  }
}
