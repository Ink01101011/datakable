import { type DiagnosticMessages, defineDiagnostic } from '../../diagnostics/catalog'
import { DEV } from '../../diagnostics/env'

declare module '../../diagnostics/catalog' {
  interface DiagnosticCatalog {
    DK_SORT_STRATEGY: {
      /** The algorithm that sorted: `tim`, `radix`, `counting`, `native` or `custom`. */
      algorithm: string
      /** Why it was chosen (auto rule, override, or fallback). */
      reason: string
      /** Rows sorted. */
      n: number
      /** Time taken, in milliseconds (scan + sort). */
      ms: number
      /** The sort entries, e.g. `['age:desc']`. */
      by: readonly string[]
      /** The primary sort column (`where`), when it is in `options.columns`. */
      column?: { index: number; id: string }
    }
    DK_SORT_COMPARATOR_INVALID: {
      /** Column id. */
      column: string
      /** Position in `options.columns`. */
      index: number
      /** `nan`: returned NaN; `not-number`: returned a non-number; `inconsistent`: f(a, b) and f(b, a) disagree. */
      reason: 'nan' | 'not-number' | 'inconsistent'
      /** The type of the bad return (`not-number`), never the value. */
      received?: string
    }
  }
}

const REASON = {
  nan: 'returned NaN',
  'not-number': 'returned a non-number',
  inconsistent: 'is inconsistent: sortFn(a, b) and sortFn(b, a) do not have opposite signs',
} as const

/** Message text (§8.2): development builds, or production via `@datakable/core/messages`. */
export const sortingMessages: DiagnosticMessages<'DK_SORT_STRATEGY'> = {
  DK_SORT_STRATEGY: {
    problem: (d) =>
      `sorted ${d.n} rows by ${d.by.join(', ')} with ${d.algorithm} in ${d.ms.toFixed(2)} ms ` +
      `(${d.reason})`,
    impact: () => 'none; reported because sorting({ debug: true }) is set',
    fix: () => [
      "to force an algorithm: sorting({ algorithm: 'tim' | 'radix' | 'counting' | " +
        "'native' }) or a column's sortAlgorithm",
      'remove debug: true from sorting() to stop these reports',
    ],
  },
}

/**
 * Codes owned by the `sorting` feature (§6.4, §8.3). `DK_SORT_COMPARATOR_INVALID` is a dev check
 * (sampled): its definition is behind `DEV`, so a production bundle has none of it.
 */
export const sortingDiagnostics = [
  defineDiagnostic(
    {
      code: 'DK_SORT_STRATEGY',
      level: 'info',
      where: (d) =>
        d.column ? { kind: 'column', ...d.column } : { kind: 'feature', name: 'sorting' },
    },
    DEV && sortingMessages.DK_SORT_STRATEGY,
  ),
]

export const comparatorDiagnostics = DEV
  ? [
      defineDiagnostic({
        code: 'DK_SORT_COMPARATOR_INVALID',
        level: 'warn',
        where: (d) => ({ kind: 'option', path: `columns[${d.index}].sortFn` }),
        problem: (d) =>
          `columns[${d.index}].sortFn (column "${d.column}") ${REASON[d.reason]}` +
          (d.received === undefined ? '' : ` (${d.received})`),
        impact: () => 'the column was sorted with the default comparator instead',
        fix: (d) => [
          d.reason === 'inconsistent'
            ? 'return a negative number when a < b, positive when a > b and 0 when equal, so that ' +
              'sortFn(a, b) === -sortFn(b, a), e.g. (a, b) => a.rank - b.rank'
            : 'return a finite number from sortFn: negative (a first), positive (b first) or 0, ' +
              'e.g. (a, b) => a.rank - b.rank',
          `or sort by a primitive key instead: columns[${d.index}].sortBy: (row) => row.<field>`,
        ],
      }),
    ]
  : []
