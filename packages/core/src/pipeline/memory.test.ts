import { describe, expect, it } from 'vitest'
import { createTable } from '../table/create-table'
import { minFilter, numSort, pager } from './test-features'

// Budget §9.3: pipeline memory at 100k rows (excluding source data) ≤ 5 MB.
// No @types/node in core: the Node built-ins are typed by hand.
type Mem = { heapUsed: number; arrayBuffers: number }
const { process } = globalThis as unknown as { process: { memoryUsage(): Mem } }
const v8 = (await import('node:v8' as string)) as { setFlagsFromString(flags: string): void }
const vm = (await import('node:vm' as string)) as { runInNewContext(code: string): unknown }
v8.setFlagsFromString('--expose-gc')
const gc = vm.runInNewContext('gc') as () => void

/** JS heap + typed-array backing stores (index arrays and Float64Array caches live outside). */
const used = () => {
  gc()
  gc()
  const m = process.memoryUsage()
  return m.heapUsed + m.arrayBuffers
}

const MB = 1024 * 1024
const N = 100_000

type R = { id: number; age: number; name: string }
const makeData = (): R[] =>
  Array.from({ length: N }, (_, i) => ({ id: i, age: (i * 7919) % 100, name: `name ${i}` }))

describe('pipeline memory (100k rows)', () => {
  it('filter + sort + paginate with a numeric column cache stays ≤ 5 MB', () => {
    const data = makeData()
    const before = used()
    const t = createTable({
      data,
      rowKey: 'id',
      columns: [{ key: 'id' }, { key: 'age' }, { key: 'name' }],
      features: [minFilter('age'), numSort('age'), pager(10)],
    })
    const api = t as unknown as Record<string, (v: unknown) => void>
    api.setMin?.(10)
    api.setSort?.('desc')
    const m = t.getRowModel()
    const after = used()
    const mb = (after - before) / MB
    console.info(`[T09] pipeline memory at 100k rows: ${mb.toFixed(2)} MB (rows ${m.rows.length})`)
    expect(m.rows).toHaveLength(10)
    expect(m.filteredCount).toBe(data.filter((r) => r.age >= 10).length)
    expect(mb).toBeLessThanOrEqual(5)
    // Keep the table and the data alive until after the measurement.
    expect(t.getData()).toBe(data)
  })
})
