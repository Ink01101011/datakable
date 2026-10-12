import { describe, expect, it } from 'vitest'
import { search } from '../features/search/search'
import { createTable } from '../table/create-table'
import { minFilter, numSort, pager } from './test-features'

// Budget §9.3: pipeline memory at 100k rows (excluding source data) ≤ 5 MB.
// Scenario: filter + sort + PAGINATED (10 rows: Row objects only for the visible page), with the
// test-only features of pipeline/test-features.ts. The real default preset on dist, plus the
// search and unpaginated scenarios, are in budgets/memory.budget.test.ts (`pnpm check:budgets`).
//
// Runs in its own vitest project (`core-memory`: one forked worker started with --expose-gc), so
// no other test file shares its heap (T37). `*.gc.test.ts` files go there.
// No @types/node in core: the Node built-ins are typed by hand.
type Mem = { heapUsed: number; arrayBuffers: number }
const { process, gc } = globalThis as unknown as {
  process: { memoryUsage(): Mem }
  gc?: () => void
}
if (typeof gc !== 'function') throw new Error('memory.gc.test.ts needs --expose-gc (core-memory)')

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

  it('filter + sort, unpaginated (90k visible rows) stays ≤ 5 MB: rows are built when read', () => {
    const data = makeData()
    const before = used()
    const t = createTable({
      data,
      rowKey: 'id',
      columns: [{ key: 'id' }, { key: 'age' }, { key: 'name' }],
      features: [minFilter('age'), numSort('age')],
    })
    const api = t as unknown as Record<string, (v: unknown) => void>
    api.setMin?.(10)
    api.setSort?.('desc')
    const m = t.getRowModel()
    const mb = (used() - before) / MB
    console.info(`[F2] unpaginated pipeline memory at 100k rows: ${mb.toFixed(2)} MB`)
    expect(m.rows).toHaveLength(m.filteredCount)
    expect(m.rows[0]?.original.age).toBe(99)
    expect(mb).toBeLessThanOrEqual(5)
    expect(t.getData()).toBe(data)
  })

  it('filter + sort + client search stays ≤ 5 MB: no per-row projection is kept', async () => {
    const data = makeData()
    const before = used()
    const t = createTable({
      data,
      rowKey: 'id',
      columns: [{ key: 'id' }, { key: 'age' }, { key: 'name' }],
      features: [minFilter('age'), search(), numSort('age'), pager(10)],
    })
    const api = t as unknown as Record<string, (v: unknown) => void>
    api.setMin?.(10)
    api.setSort?.('desc')
    await t.setSearch('Name 99')
    const m = t.getRowModel()
    const mb = (used() - before) / MB
    console.info(`[F2] search pipeline memory at 100k rows: ${mb.toFixed(2)} MB`)
    expect(m.filteredCount).toBeGreaterThan(0)
    expect(mb).toBeLessThanOrEqual(5)
    expect(t.getData()).toBe(data)
  })
})
