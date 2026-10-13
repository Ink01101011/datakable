import { describe, expect, it } from 'vitest'
import { pagination } from '../features/pagination'
import { sorting } from '../features/sorting'
import { createTable } from '../table/create-table'
import { readTrace } from './trace-store'
import { tracer } from './tracer'

const data = [{ n: 3 }, { n: 1 }, { n: 2 }]

describe('tracer (§3.4)', () => {
  it('records the last run only: run id, trigger, per-step counts and timings', () => {
    const t = createTable({ data, columns: [{ key: 'n' }], features: [sorting()] })
    t.toggleSort('n')
    const trace = readTrace(t)
    expect(trace?.run).toBe(t.explain().run)
    expect(trace?.trigger).toBe('api:toggleSort')
    expect(trace?.steps.get('sorting')).toMatchObject({ input: 3, output: 3 })
    expect(typeof trace?.steps.get('sorting')?.ms).toBe('number')
    expect(typeof trace?.ms).toBe('number')
    expect(trace?.dispatch).toMatchObject({ where: 'sorting' })
  })

  it('is installed once even when the user also passes tracer()', () => {
    let steps = 0
    const t = createTable({
      data,
      columns: [{ key: 'n' }],
      features: [sorting()],
      interceptors: [
        tracer(),
        {
          name: 'count',
          on: ['pipeline:step'],
          intercept: (_ctx, next) => {
            steps++
            return next()
          },
        },
      ],
    })
    t.toggleSort('n')
    // The pipeline runs lazily: once, after the toggle.
    expect(steps).toBe(1)
    expect(readTrace(t)?.steps.size).toBe(1)
  })

  it('a step served from the memo is marked cached by explain()', () => {
    const t = createTable({
      data,
      columns: [{ key: 'n' }],
      features: [sorting(), pagination({ pageSize: 1 })],
    })
    t.toggleSort('n')
    t.setPageIndex(1)
    const e = t.explain()
    expect(e.steps.map((s) => [s.feature, s.cached])).toEqual([
      ['sorting', true],
      ['pagination', false],
    ])
    expect(readTrace(t)?.steps.has('sorting')).toBe(false)
  })
})
