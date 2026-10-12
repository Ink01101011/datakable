import { defineDiagnostic } from '../diagnostics/catalog'

/** `options.invalidRows` (§5.1). */
export type InvalidRowsMode = 'drop' | 'flag' | 'throw'

/** An issue path matched to a column (`DK_SCHEMA_INVALID_ROW.columns`). */
export interface SchemaIssueColumn {
  /** The issue path, dot-joined (`address.city`; `''` for the row itself). */
  readonly path: string
  /** The column whose key is or contains the path, if one does. */
  readonly column?: string
  /** That column's position in `options.columns`. */
  readonly index?: number
  /** Invalid rows with an issue at this path. */
  readonly count: number
}

declare module '../diagnostics/catalog' {
  interface DiagnosticCatalog {
    DK_SCHEMA_INVALID_ROW: {
      mode: InvalidRowsMode
      /** Rows with issues. */
      count: number
      /** Rows validated. */
      total: number
      /** A sample of the invalid rows' indices in `options.data` (first few, in order). */
      rows: readonly number[]
      /** The first issue of each sampled row (redacted: `scrubSchemaIssue`). */
      issues: readonly unknown[]
      /** Issue paths with their column, most frequent first (at most a few). */
      columns: readonly SchemaIssueColumn[]
    }
    DK_SCHEMA_CRASHED: {
      mode: InvalidRowsMode
      /** Rows for which `validate` threw or rejected. */
      count: number
      rows: readonly number[]
      /** `error.name` of the first failure; the error itself is `context.cause`. */
      errorName?: string
    }
  }
}

const rowList = (rows: readonly number[], count: number) => {
  const list = rows.map((r) => `#${r}`).join(', ')
  return count > rows.length ? `${list}, …` : list
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

const handled = (mode: InvalidRowsMode, rows: string) => {
  switch (mode) {
    case 'drop':
      return `${rows} removed from the table (getInvalidRows() lists them)`
    case 'flag':
      return `${rows} kept with row.valid === false and row.issues (cell / invalidCell must handle them)`
    case 'throw':
      return 'DatakableSchemaError was thrown; the previous data was kept'
  }
}

/** Codes owned by the schema ingest (§5.1, §8.3). */
export const schemaDiagnostics = [
  defineDiagnostic({
    code: 'DK_SCHEMA_INVALID_ROW',
    level: 'error',
    where: () => ({ kind: 'option', path: 'schema' }),
    redact: { issues: 'schemaIssues' },
    problem: (d) =>
      `${d.count} of ${plural(d.total, 'row')} failed schema validation ` +
      `(rows ${rowList(d.rows, d.count)})`,
    impact: (d) => handled(d.mode, d.count === 1 ? 'that row was' : 'those rows were'),
    fix: (d) => {
      const out: string[] = []
      for (const c of d.columns) {
        const at = c.path === '' ? 'the row itself' : `"${c.path}"`
        const col =
          c.column === undefined
            ? 'no column shows it'
            : `column "${c.column}" (columns[${c.index}])`
        out.push(
          `${plural(c.count, 'row')} fail at ${at}, ${col}: fix the data source there, ` +
            `or relax the schema at ${at}`,
        )
      }
      if (d.mode === 'drop') {
        out.push(
          "use invalidRows: 'flag' to keep and show the invalid rows instead of dropping them",
        )
      }
      if (d.mode === 'throw') {
        out.push("use invalidRows: 'drop' or 'flag' to keep the table usable with invalid rows")
      }
      out.push('inspect them with table.getInvalidRows() (index, raw value and issues per row)')
      return out
    },
  }),
  defineDiagnostic({
    code: 'DK_SCHEMA_CRASHED',
    level: 'error',
    where: () => ({ kind: 'option', path: 'schema' }),
    problem: (d) =>
      `the schema threw${d.errorName ? ` ${d.errorName}` : ''} instead of returning issues ` +
      `for ${plural(d.count, 'row')} (rows ${rowList(d.rows, d.count)})`,
    impact: (d) =>
      `each such row got a synthetic issue and was treated as invalid: ` +
      handled(d.mode, d.count === 1 ? 'that row was' : 'those rows were'),
    fix: () => [
      'find the throwing refinement / transform in the schema: the original error is ' +
        'context.cause (passed to onDiagnostic)',
      'make custom checks return an issue (e.g. ctx.addIssue / a refine predicate) instead of ' +
        'throwing on unexpected input',
    ],
  }),
]
