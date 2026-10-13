import { type DiagnosticMessages, defineDiagnostic } from '../diagnostics/catalog'
import { DEV } from '../diagnostics/env'

declare module '../diagnostics/catalog' {
  interface DiagnosticCatalog {
    DK_ENV_FALLBACK: {
      /** The missing runtime capability, e.g. `'scheduler.yield'` or `'Intl.Collator'`. */
      api: string
      /** The feature that needed it (`where`). */
      feature: string
      /** What was asked for, e.g. the requested collator locale. */
      requested?: string
      /** What is used instead, e.g. `'setTimeout'` or the resolved locale. */
      fallback: string
    }
    DK_PERF_HINT: {
      /** The feature whose step exceeded the budget (`where`). */
      feature: string
      /** Its pipeline stage. */
      stage: string
      /** Measured step time, in milliseconds. */
      ms: number
      /** Rows the step received. */
      rows: number
      /** The budget, in milliseconds (§9.3: the longest task). */
      budget: number
    }
  }
}

const ms = (n: number) => `${n.toFixed(1)} ms`

/** Message text (§8.2): development builds, or production via `@datakable/core/messages`. */
export const envMessages: DiagnosticMessages<'DK_ENV_FALLBACK' | 'DK_PERF_HINT'> = {
  DK_ENV_FALLBACK: {
    problem: (d) =>
      `${d.api}${d.requested === undefined ? '' : ` (${JSON.stringify(d.requested)})`} is not ` +
      `available in this environment (feature "${d.feature}")`,
    impact: (d) => `DataKable uses ${d.fallback} instead; results are the same`,
    fix: (d) =>
      d.api === 'Intl.Collator'
        ? [
            `use a locale this runtime supports (Intl.Collator.supportedLocalesOf(${JSON.stringify(d.requested)}) is empty)`,
            'or ship full ICU data (Node: the default full-icu build; browsers: a polyfill such as @formatjs/intl)',
          ]
        : [
            `nothing to do: ${d.fallback} is a correct fallback for ${d.api}`,
            `${d.api} is used automatically where the runtime provides it`,
          ],
  },
  DK_PERF_HINT: {
    problem: (d) =>
      `the "${d.feature}" step took ${ms(d.ms)} on ${d.rows} rows, over the ${ms(d.budget)} ` +
      'budget of one task',
    impact: () => 'the page could not respond to input while it ran (a long task)',
    fix: (d) => [
      d.stage === 'none'
        ? `move the work of "${d.feature}" out of rowModel (precompute it, or run it in a Worker)`
        : `let the server do it: ${d.feature}({ mode: 'server' }) with options.fetcher`,
      `make the per-row work of "${d.feature}" cheaper (precompute keys, avoid Intl / regex per row), or run it in a Worker`,
    ],
  },
}

/** `DK_ENV_FALLBACK` (§8.3): a missing runtime capability and the fallback used. */
export const envDiagnostics = [
  defineDiagnostic(
    {
      code: 'DK_ENV_FALLBACK',
      level: 'info',
      where: (d) => ({ kind: 'feature', name: d.feature }),
    },
    DEV && envMessages.DK_ENV_FALLBACK,
  ),
]
