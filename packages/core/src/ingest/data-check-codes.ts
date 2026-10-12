import { type DiagnosticMessages, defineDiagnostic } from '../diagnostics/catalog'
import { DEV } from '../diagnostics/env'

declare module '../diagnostics/catalog' {
  interface DiagnosticCatalog {
    DK_COLUMN_PATH_NOT_FOUND: {
      /** Column id (its `key` path). */
      column: string
      /** Position in `options.columns`. */
      index: number
      /** How many rows were checked (the first rows of `data`). */
      sampled: number
      /** Existing paths close to `column`, best first. */
      suggestions: string[]
    }
    DK_COLUMN_PATH_PARTIAL: {
      column: string
      index: number
      sampled: number
      /** Sampled rows that lack the path. */
      count: number
      /** The first few of those row indices, in order. */
      rows: number[]
    }
    DK_INCONSISTENT_ROW_SHAPE: {
      sampled: number
      /** Keys missing from some sampled rows, with how many rows lack each (first few keys). */
      keys: { key: string; missing: number }[]
      /** How many keys differ in total (`keys` may be cut). */
      keyCount: number
      /** The first few row indices that lack at least one key. */
      rows: number[]
      /** How many sampled rows lack at least one key. */
      rowCount: number
    }
  }
}

const rowList = (rows: readonly number[], count: number) => {
  const list = rows.map((r) => `#${r}`).join(', ')
  return count > rows.length ? `${list}, …` : list
}

const firstRows = (n: number) => (n === 1 ? 'the first row' : `the first ${n} rows`)

/** Message text (§8.2): development builds, or production via `@datakable/core/messages`. */
export const dataCheckMessages: DiagnosticMessages<
  'DK_COLUMN_PATH_NOT_FOUND' | 'DK_COLUMN_PATH_PARTIAL' | 'DK_INCONSISTENT_ROW_SHAPE'
> = {
  DK_COLUMN_PATH_NOT_FOUND: {
    problem: (d) =>
      `columns[${d.index}] key "${d.column}" does not exist in any of ${firstRows(d.sampled)}` +
      (d.suggestions[0] === undefined ? '' : ` (did you mean "${d.suggestions[0]}"?)`),
    impact: () => "the column reads undefined in every row and renders ''",
    fix: (d) => [
      ...d.suggestions.slice(0, 3).map((s) => `columns[${d.index}]: { key: '${s}' }`),
      `or compute the value: columns[${d.index}]: { id: '${d.column}', accessor: (row) => … }`,
      'or, if the field only appears in later rows, ignore this (only the first rows are checked)',
    ],
  },
  DK_COLUMN_PATH_PARTIAL: {
    problem: (d) =>
      `columns[${d.index}] key "${d.column}" is missing in ${d.count} of ${firstRows(d.sampled)} ` +
      `(${rowList(d.rows, d.count)})`,
    impact: () => "those cells read undefined and render '' with the default formatter",
    fix: (d) => [
      `show a placeholder: columns[${d.index}].format: (v) => v ?? '—'`,
      'or fill the field in every row before passing data, if it is required',
    ],
  },
  DK_INCONSISTENT_ROW_SHAPE: {
    problem: (d) =>
      `rows have differing keys in ${firstRows(d.sampled)}: ` +
      d.keys.map((k) => `"${k.key}" missing in ${k.missing}`).join(', ') +
      (d.keyCount > d.keys.length ? `, and ${d.keyCount - d.keys.length} more` : '') +
      ` (rows ${rowList(d.rows, d.rowCount)})`,
    impact: () => "zero-config columns are the union of the keys; missing cells render ''",
    fix: (d) => [
      `pass columns explicitly: columns: [${d.keys
        .slice(0, 3)
        .map((k) => `{ key: '${k.key}' }`)
        .join(', ')}, …]`,
      'or normalise the rows so every row has the same keys',
    ],
  },
}

/** Codes owned by the ingest data checks (§5.3, §8.3). */
export const dataCheckDiagnostics = [
  defineDiagnostic(
    {
      code: 'DK_COLUMN_PATH_NOT_FOUND',
      level: 'warn',
      where: (d) => ({ kind: 'column', index: d.index, id: d.column }),
    },
    DEV && dataCheckMessages.DK_COLUMN_PATH_NOT_FOUND,
  ),
  defineDiagnostic(
    {
      code: 'DK_COLUMN_PATH_PARTIAL',
      level: 'info',
      where: (d) => ({ kind: 'column', index: d.index, id: d.column }),
    },
    DEV && dataCheckMessages.DK_COLUMN_PATH_PARTIAL,
  ),
  defineDiagnostic(
    {
      code: 'DK_INCONSISTENT_ROW_SHAPE',
      level: 'info',
      where: () => ({ kind: 'option', path: 'columns' }),
    },
    DEV && dataCheckMessages.DK_INCONSISTENT_ROW_SHAPE,
  ),
]
