import { defineDiagnostic } from '../diagnostics/catalog'

declare module '../diagnostics/catalog' {
  interface DiagnosticCatalog {
    DK_CALLBACK_FAILED: {
      /** The callback's option path, e.g. `columns[2].format`, `fetcher`, `searchFn`. */
      slot: string
      /**
       * A callback passed to a method rather than set as an option: the method (`table.setState`);
       * `slot` is then the argument (`updater`).
       */
      op?: string
      /** Column id, for cell slots. */
      column?: string
      /** A sample of the failing row indices (first few, in order). */
      rows?: readonly number[]
      /** How many calls failed (cells in a column batch; 1 for a single call). */
      count: number
      /** The slot fallback that was applied. */
      fallback: string
      /** `error.name` only; the full error is `context.cause`. */
      errorName?: string
    }
    DK_UNKNOWN: {
      op: string
      slot?: string
      errorName?: string
      fallback: string
    }
  }
}

const rowList = (rows: readonly number[] | undefined, count: number) => {
  if (!rows || rows.length === 0) return ''
  const list = rows.map((r) => `#${r}`).join(', ')
  return ` (${count > rows.length ? `first: ${list}, …` : `rows ${list}`})`
}

/** Codes owned by the errorBoundary (spec §3.4, §8.3, §8.6). `DK_INTERNAL` lives in diagnostics/codes.ts. */
export const boundaryDiagnostics = [
  defineDiagnostic({
    code: 'DK_CALLBACK_FAILED',
    level: 'error',
    where: (d) =>
      d.op === undefined
        ? { kind: 'option', path: d.slot }
        : { kind: 'operation', op: d.op, slot: d.slot },
    problem: (d) =>
      `${d.op === undefined ? '' : `${d.op}() `}${d.slot}${d.column === undefined ? '' : ` (column "${d.column}")`} threw` +
      `${d.errorName ? ` ${d.errorName}` : ''} for ` +
      `${d.count === 1 ? '1 row' : `${d.count} rows`}${rowList(d.rows, d.count)}`,
    impact: (d) => `${d.fallback}; the rest of the table is unaffected`,
    fix: (d) => [
      `make ${d.op === undefined ? d.slot : `the ${d.slot} passed to ${d.op}()`} total: guard null / undefined / unexpected types and return a fallback ` +
        'instead of throwing',
      d.rows && d.rows.length > 0
        ? `reproduce with table.explainRow() on row #${d.rows[0]}; the original error is context.cause`
        : 'the original error is context.cause (passed to onDiagnostic)',
    ],
  }),
  defineDiagnostic({
    code: 'DK_UNKNOWN',
    level: 'error',
    where: (d) =>
      d.slot ? { kind: 'operation', op: d.op, slot: d.slot } : { kind: 'operation', op: d.op },
    problem: (d) =>
      `${d.errorName ?? 'a non-Error value'} was thrown during ${d.op}` +
      `${d.slot ? ` at ${d.slot}` : ''} from code DataKable could not classify`,
    impact: (d) => `${d.fallback}; the table keeps working`,
    fix: (d) => [
      'inspect context.cause (passed to onDiagnostic) for the original error and its stack',
      `if your code runs inside ${d.op} (a callback, interceptor or plugin), catch errors there ` +
        'and return a fallback',
      'if the stack points into DataKable, report it as a bug',
    ],
  }),
]
