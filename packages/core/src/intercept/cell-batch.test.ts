import { describe, expect, it, vi } from 'vitest'
import { expandProse } from '../diagnostics/prose'
import type { Emit } from '../diagnostics/types'
import { CELL_FALLBACK, CellFailures, runCells } from './cell-batch'

const rows = new Uint32Array([0, 1, 2, 3, 4, 5])

describe('column:batch cell boundary', () => {
  it('per-slot cell fallbacks match the spec table', () => {
    expect(CELL_FALLBACK).toEqual({ accessor: undefined, format: '', filterFn: false })
  })

  it('runCells writes each cell by row index; a throwing cell gets the fallback', () => {
    const out: string[] = []
    const failures = new CellFailures()
    runCells(
      rows,
      (r) => {
        if (r % 2) throw new Error(`bad ${r}`)
        return `v${r}`
      },
      out,
      CELL_FALLBACK.format,
      failures,
    )
    expect(out).toEqual(['v0', '', 'v2', '', 'v4', ''])
    expect(failures.count).toBe(3)
    expect(Array.from(failures.sample())).toEqual([1, 3, 5])
  })

  it('works with typed-array outputs (column cache)', () => {
    const out = new Float64Array(6)
    const failures = new CellFailures()
    runCells(
      rows,
      (r) => {
        if (r === 2) throw new Error('x')
        return r * 10
      },
      out,
      Number.NaN,
      failures,
    )
    expect(Array.from(out)).toEqual([0, 10, Number.NaN, 30, 40, 50])
  })

  it('reports one DK_CALLBACK_FAILED per column per run, with count, sample rows and cause', () => {
    const emit = vi.fn()
    const failures = new CellFailures(2)
    const first = new TypeError('first')
    failures.add(4, first)
    failures.add(7, new Error('second'))
    failures.add(9, new Error('third'))
    failures.report(emit as unknown as Emit, 2, 'price', 'format', { run: 3 })
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith(
      'DK_CALLBACK_FAILED',
      {
        slot: 'columns[2].format',
        column: 'price',
        rows: [4, 7],
        count: 3,
        // The prose key (diagnostics/prose.ts); the built diagnostic reads the sentence.
        fallback: 'cells-empty',
        errorName: 'TypeError',
      },
      { cause: first, run: 3 },
    )
    expect(expandProse('cells-empty', true)).toBe("the failed cells render ''")
    // Reset after reporting, so the next run starts clean.
    expect(failures.count).toBe(0)
  })

  it('does not emit when no cell failed', () => {
    const emit = vi.fn()
    new CellFailures().report(emit as unknown as Emit, 0, 'id', 'accessor')
    expect(emit).not.toHaveBeenCalled()
  })

  it('records failures without allocating per cell (sample buffer is reused)', () => {
    const failures = new CellFailures(4)
    const buf = failures.sample()
    for (let i = 0; i < 1000; i++) failures.add(i, 'x')
    expect(failures.count).toBe(1000)
    expect(failures.sample().buffer).toBe(buf.buffer)
  })
})
