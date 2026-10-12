import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from '../../diagnostics/types'
import { defineFeature } from '../../feature/define'
import type { AnyFeature, RowModelContext } from '../../feature/types'
import { defineInterceptor } from '../../intercept/define'
import { createTable } from '../../table/create-table'
import { columnFilters } from '../column-filters/column-filters'
import { sorting } from './sorting'

let seen: Diagnostic[]
const onDiagnostic = (d: Diagnostic) => {
  seen.push(d)
}

beforeEach(() => {
  seen = []
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
})

const spy = (batches: string[]) =>
  defineInterceptor({
    name: 'batch-spy',
    on: ['column:batch'],
    hot: true,
    intercept: (c, next) => {
      batches.push(`${c.where} ${c.input.slot} ${c.input.rows.length}`)
      return next()
    },
  })

const data = [3, 1, 2, 5, 4].map((n) => ({ n, s: `x${n}` }))

describe('RowModelContext.batch', () => {
  it('runs the body as one column:batch for the column; unknown column → false', () => {
    const batches: string[] = []
    let ctx: RowModelContext | undefined
    let ran = 0
    const probe = defineFeature({
      name: 'probe',
      stage: 'filter',
      initialState: () => ({}),
      createApi: () => ({}),
      rowModel: (indices, _s, c) => {
        ctx = c
        expect(c.batch('s', 'filterFn', indices, () => ran++)).toBe(true)
        expect(c.batch('nope', 'filterFn', indices, () => ran++)).toBe(false)
        return indices
      },
    }) as AnyFeature
    const t = createTable({
      data,
      columns: [{ key: 'n' }, { key: 's' }],
      features: [probe],
      interceptors: [spy(batches)],
    })
    t.getRowModel()
    expect(ctx).toBeDefined()
    expect(ran).toBe(1)
    expect(batches).toEqual(['columns[1].filterFn filterFn 5'])
  })

  it('sortBy runs in one column:batch per data (cell slot), not once per row', () => {
    const batches: string[] = []
    const sortBy = vi.fn((r: { n: number }) => -r.n)
    const t = createTable({
      data,
      columns: [{ key: 's', sortBy }],
      features: [sorting()],
      interceptors: [spy(batches)],
    })
    t.toggleSort('s')
    expect(t.getRowModel().rows.map((r) => r.original.n)).toEqual([5, 4, 3, 2, 1])
    t.toggleSort('s')
    t.getRowModel()
    expect(batches).toEqual(['columns[0].sortBy sortBy 5'])
    expect(sortBy).toHaveBeenCalledTimes(5)
  })

  it('a column:batch interceptor that skips sortBy: every key is missing (slot fallback)', () => {
    const t = createTable({
      data,
      columns: [{ key: 's', sortBy: (r: { n: number }) => r.n }],
      features: [sorting()],
      interceptors: [
        defineInterceptor({
          name: 'skip',
          on: ['column:batch'],
          hot: true,
          intercept: (c, next) => (c.input.slot === 'sortBy' ? undefined : next()),
        }),
      ],
    })
    t.toggleSort('s')
    expect(t.getRowModel().rows.map((r) => r.original.n)).toEqual([3, 1, 2, 5, 4])
  })

  it("columnFilters' custom fn runs inside a filterFn column:batch", () => {
    const batches: string[] = []
    const t = createTable({
      data,
      columns: [{ key: 'n' }],
      features: [columnFilters()],
      interceptors: [spy(batches)],
      onDiagnostic,
    })
    t.setColumnFilter('n', { type: 'custom', value: 3, fn: (v, min) => v >= (min as number) })
    expect(t.getRowModel().rows.map((r) => r.original.n)).toEqual([3, 5, 4])
    expect(batches).toEqual(['columns[0].key accessor 5', 'columns[0].filterFn filterFn 5'])
  })

  it('a custom fn whose batch is skipped by an interceptor matches no rows (slot fallback)', () => {
    const t = createTable({
      data,
      columns: [{ key: 'n' }],
      features: [columnFilters()],
      interceptors: [
        defineInterceptor({
          name: 'skip',
          on: ['column:batch'],
          hot: true,
          intercept: (c, next) => (c.input.slot === 'filterFn' ? undefined : next()),
        }),
      ],
    })
    t.setColumnFilter('n', { type: 'custom', value: 0, fn: () => true })
    expect(t.getRowModel().rows).toEqual([])
  })

  it('a throwing custom fn still reports DK_CALLBACK_FAILED at its state path', () => {
    const t = createTable({
      data,
      columns: [{ key: 'n' }],
      features: [columnFilters()],
      onDiagnostic,
    })
    t.setColumnFilter('n', {
      type: 'custom',
      value: 0,
      fn: (v: number) => {
        if (v === 2) throw new Error('x')
        return true
      },
    })
    expect(t.getRowModel().rows.map((r) => r.original.n)).toEqual([3, 1, 5, 4])
    const d = seen.find((x) => x.code === 'DK_CALLBACK_FAILED')
    expect(d?.details).toMatchObject({ slot: 'state.columnFilters.n.fn', rows: [2], count: 1 })
  })
})
