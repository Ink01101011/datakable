import { installedText } from './catalog'
import { DEV } from './env'

/**
 * Production detail prose (§8.2, §9.3): the sentences some details carry (`fallback`, `reason`,
 * `problem`) are written as short keys at the emit site, e.g. `fallback: 'cells-undefined'`, or
 * `'page-size|10'` with arguments. A diagnostic built in development, or in production with
 * `@datakable/core/messages` installed, reads the full sentence (the key is expanded when it is
 * built); production without the messages keeps the key, so the bundle carries no prose. A value
 * that is not a known key (a plugin's own `registerFallback` text) is kept as written.
 *
 * `{0}`, `{1}` are the arguments after the key, separated by `|`.
 */
export const proseMessages: Readonly<Record<string, string>> = {
  // Cell slots (`DK_CALLBACK_FAILED` / `DK_CALLBACK_BAD_RETURN` fallback).
  'cells-coerced': 'those cells were coerced with the default formatter',
  'cells-warn': 'those cells rendered ⚠', // `<DataTable />` (@datakable/react)
  'cells-undefined': 'the failed cells read as undefined',
  'cells-empty': "the failed cells render ''",
  'rows-unmatched': 'the failed rows are treated as non-matching',
  'rows-last': 'the failed rows sort as missing values (last)',
  'cell-undefined': 'the cell reads as undefined',
  'row-key-index': "those rows use the fallback key '#<index>'",
  'sorted-native': 'the rows were sorted with the native algorithm',
  'sorted-default': 'the column was sorted with the default comparator',
  // Operation fallbacks (`intercept/fallbacks.ts`, the boundary's reports).
  'init-continued': 'table creation continued without the failed step',
  'options-kept': 'the previous options were kept',
  'destroy-continued': 'teardown continued; the table is destroyed',
  'update-dropped': 'the update was dropped (state unchanged)',
  'data-kept': 'the previous data was kept',
  'row-model-kept': 'the last good row model was kept',
  'step-passthrough': 'the step passed its input through',
  'batch-fallback':
    "the column's cells use the slot fallback ('' for format, undefined for accessor, " +
    'non-matching for filterFn, missing (sorted last) for sortBy)',
  'results-kept': "the previous results were kept (status: 'error')",
  'diagnostic-dropped': 'the diagnostic was dropped (the logger never kills the table)',
  'returned-undefined': 'the operation returned undefined',
  // Features.
  'slice-undefined': 'the slice starts as undefined',
  'api-not-installed': 'its API was not installed',
  'call-ignored': 'the call was ignored',
  'api-missing': 'table.{0}() did nothing (the API of that feature was not installed)',
  'apis-missing': 'table.{0}() did nothing (the API of those features was not installed)',
  'page-reset': 'the pagination state was reset to its initial value',
  'page-index-0': 'pageIndex was replaced by 0',
  'page-size': 'pageSize was replaced by {0}',
  'validity-ignored': 'the call was ignored; the validity filter is unchanged',
  'validity-all': "the table shows every row, as with 'all'",
  'validity-needs-flag':
    'validity filters rows flagged by schema validation, which needs `schema` and ' +
    "`invalidRows: 'flag'` (without a schema no row is invalid; with 'drop' invalid rows " +
    "are removed, with 'throw' they throw)",
  'not-searchable': 'no column is searchable: give the columns to search a `search` weight',
  collation: 'the runtime\'s collation for "{0}"',
  'not-algorithm':
    '{0} is not a sort algorithm (accepted: auto, tim, radix, counting, native, or a function); ' +
    'auto was used',
  'exsorted-failed': 'exsorted {0}Sort could not sort these keys; auto was used',
  'exsorted-range':
    'exsorted {0}Sort could not sort these keys (key range above 1,000,000); auto was used',
  'needs-int-keys':
    '{0} sorts a single column of safe integer keys (numbers or Dates, no sortFn); auto was used',
  // Sorting reasons (DK_SORT_STRATEGY, `debug: true`).
  'custom-threw': 'the custom algorithm threw',
  'custom-bad': 'the custom algorithm returned a bad value',
  'not-safe-int': 'keys are not all safe integers',
  ranks: '{0}, strings as collation ranks',
  'int-keys': '{0}, safe-integer keys',
  'auto-nearly': 'auto: safe integers, nearly sorted ({0} descents)',
  'auto-range': 'auto: safe integers, key range {0} ≤ 4n',
  'auto-wide': 'auto: safe integers, wide range, n ≥ 10k',
  'auto-wide-small': 'auto: safe integers, wide range, n < 10k',
  'auto-ranked-nearly':
    'auto: collation ranks of a string column, safe integers, nearly sorted ({0} descents)',
  'auto-ranked-range':
    'auto: collation ranks of a string column, safe integers, key range {0} ≤ 4n',
  'auto-ranked-wide':
    'auto: collation ranks of a string column, safe integers, wide range, n ≥ 10k',
  'auto-ranked-wide-small':
    'auto: collation ranks of a string column, safe integers, wide range, n < 10k',
  // Filter values (`DK_FILTER_TYPE_MISMATCH` expected).
  'prims-or-dates': 'an array of primitives or Dates',
  'prim-or-date': 'a primitive or a Date',
  'range-bound': 'number | bigint or a valid Date bound',
  'same-type': 'min and max of the same type ({0})',
  // An option given without its wrapper (`DK_INVALID_OPTION` expected).
  wrapped: "{0}({1}) from '@datakable/core/{2}'",
  // DK_INTERNAL problems.
  escaped: 'an exception escaped DataKable code',
  'unknown-code': 'unknown diagnostic code "{0}": define it with defineDiagnostic() first',
  'unknown-op': 'Unknown operation "{0}": register it with registerOperation()',
  'boundary-twice': 'A boundary interceptor is already installed ("{0}"); "{1}" was rejected',
}

/**
 * The sentence of a prose key (`'page-size|10'` → `'pageSize was replaced by 10'`): from
 * {@link proseMessages} in development (`dev`), else from the installed messages; `v` itself when
 * neither has the key.
 */
export function expandProse(v: string, dev: boolean): string {
  const [key, ...args] = v.split('|') as [string, ...string[]]
  const text = (DEV && dev ? proseMessages[key] : undefined) ?? installedText(key)
  // An argument may be a key itself (`'ranks|custom-threw'`).
  return typeof text === 'string'
    ? text.replace(/\{(\d)\}/g, (_, n: string) => expandProse(args[+n] as string, dev))
    : v
}

/** The detail fields that may hold a prose key. */
const FIELDS = ['fallback', 'reason', 'problem', 'expected'] as const

/** A copy of `details` with its prose keys expanded. */
export function expandDetails(
  details: Record<string, unknown>,
  dev: boolean,
): Record<string, unknown> {
  const out = { ...details }
  for (const f of FIELDS) {
    const v = details[f]
    if (typeof v === 'string') out[f] = expandProse(v, dev)
  }
  return out
}
