import { optionDiagnostics } from '../../catalog/codes'
import { keepDiagnostics } from '../../diagnostics/catalog'
import { describeValue } from '../../diagnostics/redact'
import { defineFeature } from '../../feature/define'
import type { FeatureContext } from '../../feature/types'
import { validityDiagnostics } from './codes'

keepDiagnostics(validityDiagnostics, optionDiagnostics)

/** Which rows the `validity` step keeps (§6.2). */
export type ValidityState = 'all' | 'valid' | 'invalid'

export interface ValidityApi {
  /** Shows every row, only the rows that passed the schema, or only the flagged ones. */
  setValidity(value: ValidityState): void
}

const NAME = 'validity'

const isValidity = (v: unknown): v is ValidityState =>
  v === 'all' || v === 'valid' || v === 'invalid'

/** A short string as written (`"broken"`); anything else by its type only. */
const received = (v: unknown) =>
  typeof v === 'string' && v.length <= 20 ? JSON.stringify(v) : describeValue(v)

/**
 * Filters rows by schema validity (§6.2, §5.1). State `'all' | 'valid' | 'invalid'` (default
 * `'all'`); stage `filter`, so it runs with `columnFilters` before search.
 *
 * - Active only with `schema` + `invalidRows: 'flag'`. In any other mode the step passes its input
 *   through, and a value other than `'all'` reports `DK_OPTION_NO_EFFECT` — from the step, so
 *   `setValidity`, `setState`, `initialState` and controlled state are all covered.
 * - A slice that is not one of the three values reads as `'all'` (`DK_INVALID_VALIDITY`);
 *   `setValidity` with one is ignored (same code).
 */
export const validity = () =>
  defineFeature({
    name: NAME,
    stage: 'filter',
    initialState: (): ValidityState => 'all',
    createApi: (ctx: FeatureContext<ValidityState>): ValidityApi => ({
      setValidity(value) {
        if (!isValidity(value)) {
          ctx.emit('DK_INVALID_VALIDITY', {
            source: 'setValidity',
            received: received(value),
            fallback: 'validity-ignored',
          })
          return
        }
        if (value !== ctx.getState()) ctx.setState(value)
      },
    }),
    rowModel: (indices, state, ctx) => {
      if (!isValidity(state)) {
        ctx.emit('DK_INVALID_VALIDITY', {
          source: 'state',
          received: received(state),
          fallback: 'validity-all',
        })
        return indices
      }
      if (state === 'all') return indices
      const flagged = ctx.flagged
      if (!flagged) {
        ctx.emit('DK_OPTION_NO_EFFECT', {
          path: 'state.validity',
          feature: NAME,
          reason: 'validity-needs-flag',
          once: false,
        })
        return indices
      }
      const keep = state === 'invalid'
      const out = new Uint32Array(indices.length)
      let n = 0
      for (let i = 0; i < indices.length; i++) {
        const r = indices[i] as number
        if ((flagged(r) !== undefined) === keep) out[n++] = r
      }
      return n === indices.length ? indices : out.subarray(0, n)
    },
  })
