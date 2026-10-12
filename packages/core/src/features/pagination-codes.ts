import { defineDiagnostic } from '../diagnostics/catalog'

declare module '../diagnostics/catalog' {
  interface DiagnosticCatalog {
    DK_INVALID_PAGINATION: {
      /** The API method that received the value, or `'state'` for a slice written to the store. */
      source: 'setPageIndex' | 'setPageSize' | 'state'
      field: 'pageIndex' | 'pageSize'
      /** The value's type only (`describeValue`), plus the number itself when it is one. */
      received: string
      /** What was done instead. */
      fallback: string
    }
  }
}

const ACCEPTED = {
  pageIndex: 'an integer ≥ 0',
  pageSize: 'an integer > 0',
} as const

/** Codes owned by the `pagination` feature (§6.5). */
export const paginationDiagnostics = [
  defineDiagnostic({
    code: 'DK_INVALID_PAGINATION',
    level: 'warn',
    where: (d) =>
      d.source === 'state'
        ? { kind: 'option', path: `state.pagination.${d.field}` }
        : { kind: 'operation', op: `table.${d.source}` },
    problem: (d) =>
      d.source === 'state'
        ? `the pagination state has ${d.field} = ${d.received}; it must be ${ACCEPTED[d.field]}`
        : `${d.source}() received ${d.received}; ${d.field} must be ${ACCEPTED[d.field]}`,
    impact: (d) => d.fallback,
    fix: (d) =>
      d.source === 'state'
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
  }),
]
