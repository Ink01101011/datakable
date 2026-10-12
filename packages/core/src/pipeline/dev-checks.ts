import { describeReturn } from '../catalog/slots'
import { defineDiagnostic } from '../diagnostics/catalog'
import { DEV } from '../diagnostics/env'
import type { Emit } from '../diagnostics/types'

/**
 * `devChecks` on `pipeline:step` (§3.4, §8.3): a feature `rowModel` must return a `Uint32Array` of
 * row indices and must not write to its input (the input is the previous step's memoised output).
 * Dev only: the definitions, their text and the checks sit behind `DEV`, so a production bundle has
 * none of it. They run only when a step is recomputed (memo misses), with bounded cost.
 */

declare module '../diagnostics/catalog' {
  interface DiagnosticCatalog {
    DK_FEATURE_BAD_OUTPUT: {
      feature: string
      /** What `rowModel` returned, as a type (`an Array`); never the value. */
      received: string
      /** An out-of-range index (a `Uint32Array` output): its value and the row count. */
      index?: number
      rowCount?: number
    }
    DK_FEATURE_MUTATED_INPUT: {
      feature: string
    }
  }
}

export const stepDiagnostics = DEV
  ? [
      defineDiagnostic({
        code: 'DK_FEATURE_BAD_OUTPUT',
        level: 'error',
        where: (d) => ({ kind: 'feature', name: d.feature }),
        problem: (d) =>
          d.index === undefined
            ? `feature "${d.feature}" rowModel() returned ${d.received}, not a Uint32Array of ` +
              'row indices'
            : `feature "${d.feature}" rowModel() returned row index ${d.index}, but the data has ` +
              `${d.rowCount} rows`,
        impact: () => 'the step passed its input through (the feature had no effect this run)',
        fix: (d) => [
          `return a Uint32Array of row indices from rowModel() of feature "${d.feature}": ` +
            'indices.subarray(0, n), a new Uint32Array(n) you filled, or Uint32Array.from(list)',
          d.index === undefined
            ? 'rowModel() is synchronous; return the input indices when the feature is inactive'
            : 'only return indices taken from the input (each is a position in options.data)',
        ],
      }),
      defineDiagnostic({
        code: 'DK_FEATURE_MUTATED_INPUT',
        level: 'warn',
        where: (d) => ({ kind: 'feature', name: d.feature }),
        problem: (d) => `feature "${d.feature}" rowModel() wrote to its input indices`,
        impact: () =>
          "the input is the previous step's memoised output: later runs can show rows in the " +
          'wrong order or the wrong rows until the data changes',
        fix: (d) => [
          `copy before changing in feature "${d.feature}": indices.slice().sort(...) instead of ` +
            'indices.sort(...)',
          'or write the result into a new Uint32Array',
        ],
      }),
    ]
  : []

/** At most this many input positions are hashed per step. */
const SAMPLES = 64

/**
 * A bounded fingerprint of an index array: FNV-1a over the length and at most {@link SAMPLES}
 * evenly spaced positions (every position when shorter; position 0 always).
 */
export function indexPrint(indices: Uint32Array): number {
  const n = indices.length
  const stride = n <= SAMPLES ? 1 : Math.floor(n / SAMPLES)
  let h = Math.imul(0x811c9dc5 ^ n, 0x01000193)
  for (let i = 0, k = 0; i < n && k < SAMPLES; i += stride, k++) {
    h = Math.imul(h ^ (indices[i] as number), 0x01000193)
  }
  return h >>> 0
}

/** The first index `>= rowCount`, or -1. */
function outOfRange(out: Uint32Array, rowCount: number): number {
  for (let i = 0; i < out.length; i++) if ((out[i] as number) >= rowCount) return out[i] as number
  return -1
}

/**
 * Checks one recomputed step (dev): reports a mutated input (`before` = {@link indexPrint} of the
 * input before `rowModel` ran) and a bad output. Returns whether `out` can be used.
 */
export function checkStep(
  emit: Emit,
  feature: string,
  input: Uint32Array,
  before: number,
  out: unknown,
  rowCount: number,
): boolean {
  if (indexPrint(input) !== before) emit('DK_FEATURE_MUTATED_INPUT', { feature })
  if (!(out instanceof Uint32Array)) {
    emit('DK_FEATURE_BAD_OUTPUT', { feature, received: describeReturn(out) })
    return false
  }
  const index = outOfRange(out, rowCount)
  if (index < 0) return true
  emit('DK_FEATURE_BAD_OUTPUT', { feature, received: 'a Uint32Array', index, rowCount })
  return false
}
