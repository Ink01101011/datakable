import { columnFilters, createTable, type Diagnostic, sorting } from '../index'
import { fail, loose, type Person, people, sink } from './harness'

/**
 * The in-step scenarios of the §6.6 status rule (pipeline/status-rule.ts), shared by the default
 * suite and the suite that flips the predicate: a handled cell-level problem inside a step that
 * did not throw.
 */
export function inStepScenarios() {
  const { seen, onDiagnostic } = sink()
  const mixed = (): Person[] => {
    const d = people()
    ;(d[1] as { n: unknown }).n = 'one'
    return d
  }
  return {
    seen: seen as Diagnostic[],
    /** `DK_FILTER_TYPE_MISMATCH`: a range filter meets a string cell. */
    typeMismatch: () => {
      const t = loose(
        createTable({
          data: mixed(),
          columns: [{ key: 'n' }],
          features: [columnFilters()],
          onDiagnostic,
        }),
      )
      t.setColumnFilter('n', { type: 'range', value: { min: 0 } })
      return t
    },
    /** `DK_CALLBACK_FAILED` from a custom filter `fn` (column:batch `filterFn`). */
    customFilter: () => {
      const t = loose(
        createTable({
          data: people(),
          columns: [{ key: 'n' }],
          features: [columnFilters()],
          onDiagnostic,
        }),
      )
      t.setColumnFilter('n', { type: 'custom', fn: fail })
      return t
    },
    /** `DK_CALLBACK_FAILED` from an accessor read into the column cache by the sort step. */
    accessor: () => {
      const t = loose(
        createTable({
          data: people(),
          columns: [{ key: 'id' }, { id: 'calc', accessor: fail }],
          features: [sorting()],
          onDiagnostic,
        }),
      )
      t.toggleSort('calc')
      return t
    },
  }
}
