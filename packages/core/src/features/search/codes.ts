import { type DiagnosticMessages, defineDiagnostic } from '../../diagnostics/catalog'
import { DEV } from '../../diagnostics/env'

declare module '../../diagnostics/catalog' {
  interface DiagnosticCatalog {
    DK_SEARCH_FAILED: {
      /** `error.name` of the rejection / throw; the full error is `context.cause`. */
      errorName?: string
      /** `bad-result`: resolved with neither an array of rows nor `{ keys }`. */
      problem?: 'bad-result'
      /** The type of the bad result (`describeValue`), never the value. */
      received?: string
      /** Whether a previous `searchFn` result is shown (`false`: none applied yet). */
      hadResults: boolean
    }
    DK_SEARCH_COLUMN_SKIPPED: {
      /** Column id (`key` or `id`). */
      column: string
      /** Position in the table's columns (`options.columns`, else the derived columns). */
      index: number
    }
  }
}

/** Message text (§8.2): development builds, or production via `@datakable/core/messages`. */
export const searchMessages: DiagnosticMessages<'DK_SEARCH_FAILED'> = {
  DK_SEARCH_FAILED: {
    problem: (d) =>
      d.problem === 'bad-result'
        ? `searchFn resolved with ${d.received}, not an array of rows (from ctx.rows) or ` +
          '{ keys: RowKey[] }'
        : `searchFn rejected or threw${d.errorName ? ` ${d.errorName}` : ''}`,
    impact: (d) =>
      d.hadResults
        ? "the previous search results are kept (status: 'error')"
        : "the rows are shown unsearched (status: 'error')",
    fix: (d) => [
      d.problem === 'bad-result'
        ? 'return ctx.rows.filter(...) (the row objects themselves) or { keys: [...] } with the ' +
          'rowKey values of the matching rows'
        : 'check the request searchFn sends (the original error is context.cause, passed to ' +
          'onDiagnostic)',
      'retry from the UI with flushSearch(); the next query change runs searchFn again',
    ],
  },
}

/** Codes owned by the `search` feature (spec §6.3, §8.3). */
export const searchDiagnostics = [
  defineDiagnostic(
    {
      code: 'DK_SEARCH_FAILED',
      level: 'error',
      where: () => ({ kind: 'option', path: 'searchFn' }),
    },
    DEV && searchMessages.DK_SEARCH_FAILED,
  ),
]
