import { describe, expect, it } from 'vitest'
import { columnFilters, createTable, defineInterceptor, search, sorting } from '../index'
import { loose, type Person, people, useHarness } from './harness'

useHarness()

/**
 * R6 carry-over: every per-cell user callback runs inside one `column:batch` per column (§3.4:
 * hot ops are intercepted per batch, never per cell), with `where` = the slot path. A recording
 * interceptor sees the batches; each callback asserts it runs inside one.
 */
function recorder() {
  const batches: string[] = []
  let inside = 0
  const interceptor = defineInterceptor({
    name: 'record',
    on: ['column:batch'],
    hot: true,
    intercept(ctx, next) {
      batches.push(`${ctx.input.slot} @ ${ctx.where}`)
      inside++
      try {
        return next()
      } finally {
        inside--
      }
    },
  })
  /** Wraps a callback: counts calls made outside any batch. */
  const outside = { count: 0 }
  const guard =
    <A extends unknown[], R>(fn: (...a: A) => R) =>
    (...a: A): R => {
      if (inside === 0) outside.count++
      return fn(...a)
    }
  return { batches, interceptor, guard, outside }
}

describe('cell slots go through column:batch (one per column per read)', () => {
  it('accessor: one batch when the sort step reads the column, none on a cached re-run', () => {
    const r = recorder()
    const t = loose(
      createTable({
        data: people(),
        columns: [{ key: 'id' }, { id: 'calc', accessor: r.guard((p: Person) => p.n * 2) }],
        features: [sorting()],
        interceptors: [r.interceptor],
      }),
    )
    t.toggleSort('calc')
    t.getRowModel()
    expect(r.batches).toEqual(['accessor @ columns[1].accessor'])
    t.toggleSort('calc')
    t.getRowModel()
    expect(r.batches).toHaveLength(1)
    expect(r.outside.count).toBe(0)
  })

  it('key path: the accessor batch has where = columns[i].key', () => {
    const r = recorder()
    const t = loose(
      createTable({
        data: people(),
        columns: [{ key: 'n' }],
        features: [sorting()],
        interceptors: [r.interceptor],
      }),
    )
    t.toggleSort('n')
    t.getRowModel()
    expect(r.batches).toEqual(['accessor @ columns[0].key'])
  })

  it('format: one batch per searched column (after its accessor batch)', async () => {
    const r = recorder()
    const t = loose(
      createTable({
        data: people(),
        columns: [{ key: 'name', format: r.guard((v: string) => v.toUpperCase()) }],
        features: [search()],
        interceptors: [r.interceptor],
      }),
    )
    await t.setSearch('ada')
    t.getRowModel()
    expect(r.batches).toEqual(['accessor @ columns[0].key', 'format @ columns[0].format'])
    expect(r.outside.count).toBe(0)
  })

  it('filterFn (custom filter): one batch per run of the filter step', () => {
    const r = recorder()
    const t = loose(
      createTable({
        data: people(),
        columns: [{ key: 'n' }],
        features: [columnFilters()],
        interceptors: [r.interceptor],
      }),
    )
    t.setColumnFilter('n', { type: 'custom', fn: r.guard((v: number) => v > 1) })
    expect(t.getRowModel().filteredCount).toBe(2)
    expect(r.batches).toEqual(['accessor @ columns[0].key', 'filterFn @ columns[0].filterFn'])
    t.setColumnFilter('n', { type: 'custom', fn: r.guard((v: number) => v > 2) })
    t.getRowModel()
    expect(r.batches.filter((b) => b.startsWith('filterFn'))).toHaveLength(2)
    expect(r.outside.count).toBe(0)
  })

  it('sortBy: one batch per data reference', () => {
    const r = recorder()
    const t = loose(
      createTable({
        data: people(),
        columns: [{ key: 'name', sortable: true, sortBy: r.guard((p: Person) => p.n) }],
        features: [sorting()],
        interceptors: [r.interceptor],
      }),
    )
    t.toggleSort('name')
    expect(t.getRowModel().rows.map((row) => (row.original as Person).id)).toEqual([
      'p1',
      'p2',
      'p0',
    ])
    expect(r.batches).toEqual(['sortBy @ columns[0].sortBy'])
    t.toggleSort('name')
    t.getRowModel()
    expect(r.batches).toHaveLength(1)
    expect(r.outside.count).toBe(0)
  })

  it('a skipped batch (interceptor not calling next) applies the slot fallback', () => {
    const t = loose(
      createTable({
        data: people(),
        columns: [{ key: 'n' }],
        features: [columnFilters()],
        interceptors: [
          defineInterceptor({
            name: 'skip',
            on: ['column:batch'],
            hot: true,
            intercept: (ctx, next) => (ctx.input.slot === 'filterFn' ? undefined : next()),
          }),
        ],
      }),
    )
    t.setColumnFilter('n', { type: 'custom', fn: () => true })
    // filterFn fallback: no row matches.
    expect(t.getRowModel().filteredCount).toBe(0)
  })
})
