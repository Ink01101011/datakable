import { defineDiagnostic } from '../../diagnostics/catalog'
import { DEV } from '../../diagnostics/env'

// Its own module, not `./codes`: `search()` imports it, and `./codes` registers DK_SEARCH_FAILED,
// which only the `searchFn` engine (`search-engine.ts`) emits and keeps.

/**
 * `DK_SEARCH_COLUMN_SKIPPED` (#27) is a development hint: with no column declaring a `search`
 * weight, a column of dates, arrays or other objects is not searched. Its definition is behind
 * `DEV`, so a production bundle has none of it.
 */
export const skippedColumnDiagnostics = DEV
  ? [
      defineDiagnostic({
        code: 'DK_SEARCH_COLUMN_SKIPPED',
        level: 'info',
        where: (d) => ({ kind: 'column', index: d.index, id: d.column }),
        problem: (d) =>
          `column "${d.column}" holds dates, arrays or other objects, and no column declares a ` +
          'search weight: such a column is not searched (only strings, numbers and booleans are)',
        impact: () => 'search does not match the values of this column',
        fix: (d) => [
          `give it a search weight to search it: columns: [{ key: '${d.column}', search: 1 }, …], ` +
            'and give one to every other column to search (once a column declares a weight, ' +
            'only weighted columns are searched)',
          `to choose the text it matches, add format: (value) => string to columns[${d.index}] ` +
            '(by default dates match their toLocaleString(), arrays their items joined by ", ")',
        ],
      }),
    ]
  : []
