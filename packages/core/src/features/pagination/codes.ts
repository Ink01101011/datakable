import { type DiagnosticMessages, defineDiagnostic } from '../../diagnostics/catalog'
import { DEV } from '../../diagnostics/env'

declare module '../../diagnostics/catalog' {
  interface DiagnosticCatalog {
    DK_INVALID_PAGINATION: {
      /**
       * The API method that received the value, `'state'` for a slice written to the store, or
       * `'option'` for `pagination({ pageSize })` (checked here in production, where the option
       * validator is off).
       */
      source: 'setPageIndex' | 'setPageSize' | 'state' | 'option'
      field: 'pageIndex' | 'pageSize'
      /** The value's type only (`describeValue`), plus the number itself when it is one. */
      received: string
      /** What was done instead. */
      fallback: string
    }
    DK_ROW_COUNT_MISSING: {
      /** `data.length`, used as the total instead. */
      rows: number
    }
  }
}

const ACCEPTED = {
  pageIndex: 'an integer ≥ 0',
  pageSize: 'an integer > 0',
} as const

/** Message text (§8.2): development builds, or production via `@datakable/core/messages`. */
export const paginationMessages: DiagnosticMessages<
  'DK_INVALID_PAGINATION' | 'DK_ROW_COUNT_MISSING'
> = {
  DK_INVALID_PAGINATION: {
    problem: (d) =>
      d.source === 'option'
        ? `pagination({ pageSize: ${d.received} }); pageSize must be ${ACCEPTED.pageSize}`
        : d.source === 'state'
          ? `the pagination state has ${d.field} = ${d.received}; it must be ${ACCEPTED[d.field]}`
          : `${d.source}() received ${d.received}; ${d.field} must be ${ACCEPTED[d.field]}`,
    impact: (d) => d.fallback,
    fix: (d) =>
      d.source === 'option'
        ? [
            `pass ${ACCEPTED.pageSize} to pagination({ pageSize }), or leave it out for the ` +
              'default of 10',
          ]
        : d.source === 'state'
          ? [
              `write pagination.${d.field} as ${ACCEPTED[d.field]} (check initialState, setState and ` +
                'the controlled options.state)',
              d.field === 'pageIndex'
                ? 'use table.setPageIndex(i): it clamps to the existing pages'
                : 'use table.setPageSize(n): it also keeps the first visible row on screen',
            ]
          : [
              `pass ${ACCEPTED[d.field]} to ${d.source}()` +
                (d.received.startsWith('string') ? ' (convert input values with Number(...))' : ''),
            ],
  },
  DK_ROW_COUNT_MISSING: {
    problem: () =>
      'pagination is in server mode, but there is no fetcher and no rowCount option: the ' +
      'total number of rows is unknown',
    impact: (d) =>
      `the page count falls back to data.length (${d.rows}) as the total: one page, ` +
      'canNextPage() is false',
    fix: () => [
      'pass the total from your API: setOptions({ data: page.rows, rowCount: page.total })',
      "or pass a fetcher that resolves { rows, rowCount }, or use pagination({ mode: 'client' }) " +
        'with all rows as data',
    ],
  },
}

/** Codes owned by the `pagination` feature (§6.5). */
export const paginationDiagnostics = [
  defineDiagnostic(
    {
      code: 'DK_INVALID_PAGINATION',
      level: 'warn',
      where: (d) =>
        d.source === 'option'
          ? { kind: 'feature', name: 'pagination' }
          : d.source === 'state'
            ? { kind: 'option', path: `state.pagination.${d.field}` }
            : { kind: 'operation', op: `table.${d.source}` },
    },
    DEV && paginationMessages.DK_INVALID_PAGINATION,
  ),
  defineDiagnostic(
    {
      code: 'DK_ROW_COUNT_MISSING',
      level: 'warn',
      where: () => ({ kind: 'option', path: 'rowCount' }),
    },
    DEV && paginationMessages.DK_ROW_COUNT_MISSING,
  ),
]
