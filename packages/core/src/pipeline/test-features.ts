import { defineFeature } from '../feature/define'
import type { AnyFeature, RowModelContext } from '../feature/types'

/** Test-only features over a numeric column (the built-ins land in wave 6). */

type Values = Float64Array | readonly unknown[]

const num = (v: Values, i: number) => Number(v[i])

/** Keeps rows whose `column` value is ≥ `min` (inactive when `min` is undefined). */
export const minFilter = (column: string, spy?: (ctx: RowModelContext) => void): AnyFeature =>
  defineFeature({
    name: 'minFilter',
    stage: 'filter',
    initialState: () => ({ min: undefined as number | undefined }),
    createApi: (ctx) => ({
      setMin: (min: number | undefined) => ctx.setState({ min }),
    }),
    rowModel: (indices, state, ctx) => {
      spy?.(ctx)
      if (state.min === undefined) return indices
      const v = ctx.getColumnValues(column) as Values
      const out = new Uint32Array(indices.length)
      let n = 0
      for (let i = 0; i < indices.length; i++) {
        const r = indices[i] as number
        if (num(v, r) >= state.min) out[n++] = r
      }
      return out.subarray(0, n)
    },
  }) as AnyFeature

/** Sorts by `column` (`by: 'asc' | 'desc' | undefined`). */
export const numSort = (column: string, spy?: () => void): AnyFeature =>
  defineFeature({
    name: 'numSort',
    stage: 'sort',
    initialState: () => ({ by: undefined as 'asc' | 'desc' | undefined }),
    createApi: (ctx) => ({
      setSort: (by: 'asc' | 'desc' | undefined) => ctx.setState({ by }),
    }),
    rowModel: (indices, state, ctx) => {
      spy?.()
      if (!state.by) return indices
      const v = ctx.getColumnValues(column) as Values
      const sign = state.by === 'asc' ? 1 : -1
      return indices.slice().sort((a, b) => sign * (num(v, a) - num(v, b)))
    },
  }) as AnyFeature

/** Returns the page `pageIndex` of size `pageSize`. */
export const pager = (pageSize = 10, spy?: () => void): AnyFeature =>
  defineFeature({
    name: 'pager',
    stage: 'paginate',
    initialState: () => ({ pageIndex: 0, pageSize }),
    createApi: (ctx) => ({
      setPage: (pageIndex: number) => ctx.setState((s) => ({ ...s, pageIndex })),
    }),
    rowModel: (indices, state) => {
      spy?.()
      const start = state.pageIndex * state.pageSize
      return indices.subarray(start, start + state.pageSize)
    },
  }) as AnyFeature
