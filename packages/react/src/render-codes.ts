import { type DiagnosticMessages, defineDiagnostic, defineSlot } from '@datakable/core'

declare module '@datakable/core' {
  interface DiagnosticCatalog {
    DK_RENDER_FAILED: {
      /** The render operation: `render:table` (the `<DataTable />` body boundary). */
      op: 'render:table'
      /** `error.name` only; the full error is `context.cause`. */
      errorName?: string
    }
  }
}

// No @types/node here: declare just what is read.
declare const process: { env: { NODE_ENV?: string } }

/**
 * `columns[i].cell` (§4.1, §10): renders a React node synchronously. A thenable is a contract
 * violation (`DK_CALLBACK_BAD_RETURN`); `<DataTable />` renders `⚠` instead.
 */
export const cellSlot = defineSlot({
  name: 'cell',
  returns: 'sync',
  fallback: 'those cells rendered ⚠',
})

/** `columns[i].invalidCell` (§5.1): renders a flagged cell; same contract as `cell`. */
export const invalidCellSlot = defineSlot({
  name: 'invalidCell',
  returns: 'sync',
  fallback: 'those cells rendered ⚠',
})

/** Message text (§8.2): development builds, or production via `datakable/messages`. */
export const renderMessages: DiagnosticMessages<'DK_RENDER_FAILED'> = {
  DK_RENDER_FAILED: {
    problem: (d) =>
      `a component rendered inside the table body threw${d.errorName ? ` ${d.errorName}` : ''} ` +
      '(a child of a column cell / invalidCell)',
    impact: () =>
      'the table body shows the Error state; the header, search and pagination keep working, and ' +
      'the body renders again on the next row model or Retry',
    fix: () => [
      'find the throwing component in context.cause (passed to onDiagnostic) and make it total: ' +
        'guard null / undefined / unexpected values instead of throwing',
      'a throw in the cell function itself is caught per cell (⚠, DK_CALLBACK_FAILED); wrap ' +
        'components that can throw in your own error boundary for a per-cell fallback',
    ],
  },
}

/** Codes owned by `<DataTable />` (§8.3, react). Emitted in production too; text behind NODE_ENV. */
export const renderDiagnostics = [
  defineDiagnostic(
    {
      code: 'DK_RENDER_FAILED',
      level: 'error',
      where: (d) => ({ kind: 'operation', op: d.op }),
    },
    // Written out (not an imported flag) so a consumer's bundler folds it while parsing (§8.2).
    process.env.NODE_ENV !== 'production' && renderMessages.DK_RENDER_FAILED,
  ),
]
