import { defineFeature, defineOptions, type FeatureTypes, type Path } from '@datakable/core'

// 1. The state and API as hoisted generic types over the row type T.
export type ThresholdState<T> = { column: Path<T> | null; min: number }
export type ThresholdApi<T> = {
  /** Keeps the rows whose numeric `column` is at least `min`. */
  setThreshold(column: Path<T>, min: number): void
  clearThreshold(): void
}

// 2. The type-lambdas: `this['T']` becomes the table's row type.
export interface ThresholdTypes extends FeatureTypes {
  state: ThresholdState<this['T']>
  api: ThresholdApi<this['T']>
}

export interface ThresholdOptions {
  /** The starting minimum (default 0). */
  min?: number
}

// Hoisted, so the schema is built once (checked in development only).
const thresholdOptions = {
  min: { type: 'number', check: (v: number) => v >= 0, expected: 'a number ≥ 0' },
} as const

// 3. The factory: options close over the definition.
export const threshold = (opts: ThresholdOptions = {}) =>
  defineFeature<'threshold', ThresholdTypes>({
    name: 'threshold', // the state slice key, unique per table
    stage: 'filter', // runs with the column filters, before search
    options: defineOptions(thresholdOptions, opts),
    initialState: () => ({ column: null, min: opts.min ?? 0 }),
    createApi: (ctx) => ({
      setThreshold: (column, min) => ctx.setState({ column, min }),
      clearThreshold: () => ctx.setState({ column: null, min: opts.min ?? 0 }),
    }),
    // Pure: read the indices, return the kept ones (a new array or a subarray), never mutate.
    rowModel: (indices, state, ctx) => {
      if (state.column === null) return indices
      const values = ctx.getColumnValues(state.column) // cached per data + column
      if (values === undefined) return indices // not a column
      const out = new Uint32Array(indices.length)
      let n = 0
      for (const r of indices) {
        const v = values[r]
        if (typeof v === 'number' && v >= state.min) out[n++] = r
      }
      return out.subarray(0, n)
    },
  })
