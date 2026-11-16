import { defineDiagnostic } from '../../diagnostics/catalog'
import { DEV } from '../../diagnostics/env'

// Its own module, not `./codes`: `search()` imports it, and `./codes` registers DK_SEARCH_FAILED,
// which only the `searchFn` engine (`search-engine.ts`) emits and keeps.

/**
 * `DK_SEARCH_COLUMN_SKIPPED` (#27) and `DK_SEARCH_FUZZY_OFF` (#123) are development hints: with no
 * column declaring a `search` weight, a column of dates, arrays or other objects is not searched;
 * above `fuzzyMaxRows` rows, typos stop matching. Their definitions are behind `DEV`, so a
 * production bundle has none of them.
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
      defineDiagnostic({
        code: 'DK_SEARCH_FUZZY_OFF',
        level: 'info',
        where: () => ({ kind: 'option', path: 'fuzzyMaxRows' }),
        problem: (d) =>
          `the data has ${d.rows} rows, more than fuzzyMaxRows (${d.limit}): search matches it ` +
          `as with fuzzyMaxDistance: 0 (configured: ${d.distance})`,
        impact: () =>
          'a query with a typo no longer matches; exact, prefix and substring matches are ' +
          'unchanged, and no word index is kept (faster keystrokes, less memory)',
        fix: (d) => [
          `to keep typo matching on this data, raise fuzzyMaxRows to ${d.rows} or more, or remove it`,
          'nothing to fix if this is intended (reported once per data array, in development only)',
        ],
      }),
    ]
  : []
