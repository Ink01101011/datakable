import type { DiagnosticCode } from '../diagnostics/catalog'

/**
 * THE §6.6 / §8.6 status rule for diagnostics reported inside a pipeline step that did not throw
 * ("any diagnostic that affects the row model sets status 'error'"): whether `code`, reported from
 * a step's `ctx.emit` or from a column cache read (`column:batch`) during a run, makes that row
 * model `'error'`. This predicate is the only place the answer lives; the runner and the column
 * cache count through it (flagged steps are not memoised, flagged cache entries re-flag on every
 * read), so changing it is the whole change.
 *
 * OPEN USER QUESTION (R6 → T30): in-step diagnostics such as `DK_FILTER_TYPE_MISMATCH`, a
 * throwing custom filter `fn`, `sortBy`, `sortFn`, `format` or a throwing accessor currently leave
 * the status as it was. Default until the user answers (orchestrator): a handled cell-level problem
 * is a diagnostic only, so `false` for every code. The other answer is `return true`, or a
 * narrower rule by level (`getDiagnosticDefinition(code)?.level !== 'info'`) or by a list of codes.
 *
 * Not decided here (always `'error'`): a step that throws or returns a bad output, a failed
 * `data:ingest`, a failed fetcher request, a failed `searchFn`. Not counted: diagnostics outside a
 * pipeline run (`Row.getValue` during render, `rowKey` while building rows).
 */
export function inStepDiagnosticSetsError(_code: DiagnosticCode): boolean {
  return false
}
