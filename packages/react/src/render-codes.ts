import {
  type DiagnosticMessages,
  defineDiagnostic,
  defineSlot,
  registerOperation,
} from '@datakable/core'

declare module '@datakable/core' {
  interface DiagnosticCatalog {
    DK_RENDER_FAILED: {
      /**
       * The render operation: `render:cell` (a cell's boundary: a component returned by `cell` /
       * `invalidCell`) or `render:table` (the body boundary: a component outside the cells).
       */
      op: 'render:table' | 'render:cell'
      /** `render:cell`: the slot whose component threw, `columns[1].cell`. */
      slot?: string
      /** `render:cell`: the column id. */
      column?: string
      /** `render:cell`: the row's index in the data (the first failure; later ones are deduped). */
      row?: number
      /** `error.name` only; the full error is `context.cause`. */
      errorName?: string
    }
  }

  /** §3.4: React error boundaries, not interceptor chains (nothing runs interceptors on them). */
  interface Operations {
    'render:table': { kind: 'sync'; input: undefined; output: undefined }
    'render:cell': {
      kind: 'sync'
      input: { column: string; slot: 'cell' | 'invalidCell'; row: number }
      output: undefined
    }
  }
}

/**
 * Registers `render:table` / `render:cell` (§3.4: owned by `@datakable/react`, not core). Neither
 * is hot: no interceptor chain runs per cell, so `on: '*'` interceptors get no hot-op warning for
 * them. Idempotent (an identical re-registration is a no-op).
 */
export function registerRenderOperations(): void {
  registerOperation('render:table', { kind: 'sync', hot: false })
  registerOperation('render:cell', { kind: 'sync', hot: false })
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
      d.op === 'render:cell'
        ? `a component returned by ${d.slot} (column "${d.column}") threw` +
          `${d.errorName ? ` ${d.errorName}` : ''} while rendering row #${d.row}`
        : `a component rendered inside the table body threw${d.errorName ? ` ${d.errorName}` : ''} ` +
          '(outside the cells: a components.Empty / Loading / Error part)',
    impact: (d) =>
      d.op === 'render:cell'
        ? 'that cell renders ⚠; the other cells and rows, the header, search, pagination and the ' +
          "table API keep working, and the cell renders again when its row's data or the columns " +
          'change'
        : 'the table body shows the Error state; the header, search and pagination keep working, ' +
          'and the body renders again on the next row model or Retry',
    fix: (d) =>
      d.op === 'render:cell'
        ? [
            `find the throwing component in context.cause (passed to onDiagnostic) and make it ` +
              `total: guard null / undefined / unexpected values of column "${d.column}" ` +
              'instead of throwing',
            'for your own fallback instead of ⚠, wrap the component in an error boundary inside ' +
              `${d.slot}`,
          ]
        : [
            'find the throwing component in context.cause (passed to onDiagnostic) and make it ' +
              'total: guard null / undefined / unexpected values instead of throwing',
            'a component returned by a column cell / invalidCell is caught per cell (⚠); a throw in ' +
              'the cell function itself is DK_CALLBACK_FAILED',
          ],
  },
}

/** Codes owned by `<DataTable />` (§8.3, react). Emitted in production too; text behind NODE_ENV. */
export const renderDiagnostics = [
  defineDiagnostic(
    {
      code: 'DK_RENDER_FAILED',
      level: 'error',
      where: (d) =>
        d.slot ? { kind: 'operation', op: d.op, slot: d.slot } : { kind: 'operation', op: d.op },
    },
    // Written out (not an imported flag) so a consumer's bundler folds it while parsing (§8.2).
    process.env.NODE_ENV !== 'production' && renderMessages.DK_RENDER_FAILED,
  ),
]
