import { suggest } from '../../catalog/suggest'
import { defineDiagnostic } from '../../diagnostics/catalog'

declare module '../../diagnostics/catalog' {
  interface DiagnosticCatalog {
    DK_FILTER_TYPE_MISMATCH: {
      /** Column id (`key` or `id`). */
      column: string
      /** Position in `options.columns`. */
      index: number
      /** The filter kind (`type`) as given, e.g. `contains`. */
      filter: string
      /** `cell`: cell values of the wrong type; `filter`: the filter value itself is malformed. */
      source: 'cell' | 'filter'
      /** What the filter accepts, e.g. `string`, `number | bigint`, `Date`, `array`. */
      expected: string
      /** The type of the first offending value (`string`, `number`, `Date`, `array`, …). */
      received: string
      /** Cells of the wrong type (0 for `source: 'filter'`). */
      count: number
      /** A sample of their row indices (first few, in order). */
      rows: readonly number[]
    }
  }
}

/** The filter kinds of §6.1. */
export const FILTER_KINDS = ['equals', 'contains', 'in', 'range', 'custom'] as const

const rowList = (rows: readonly number[], count: number) => {
  if (rows.length === 0) return ''
  const list = rows.map((r) => `#${r}`).join(', ')
  return count > rows.length ? ` (first: ${list}, …)` : ` (rows ${list})`
}

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`)

/** A conversion from `received` to `expected`, as code, when one is obvious. */
function convert(expected: string, received: string): string | undefined {
  if (expected.includes('number') && received === 'string') return 'Number(x)'
  if (expected === 'string' && (received === 'number' || received === 'bigint')) return 'String(x)'
  if (expected === 'Date' && (received === 'string' || received === 'number')) return 'new Date(x)'
  return undefined
}

/** Codes owned by the `columnFilters` feature (§6.1, §8.3). */
export const columnFiltersDiagnostics = [
  defineDiagnostic({
    code: 'DK_FILTER_TYPE_MISMATCH',
    level: 'warn',
    where: (d) => ({ kind: 'column', index: d.index, id: d.column }),
    problem: (d) =>
      d.source === 'filter'
        ? `the "${d.filter}" filter on column "${d.column}" has a value of type ${d.received}; ` +
          `it expects ${d.expected}`
        : `the "${d.filter}" filter on column "${d.column}" compares ${d.expected} values, but ` +
          `${plural(d.count, 'cell holds', 'cells hold')} another type (first: ` +
          `${d.received})${rowList(d.rows, d.count)}`,
    impact: (d) =>
      d.source === 'filter'
        ? 'the filter matches no rows until its value is fixed'
        : 'those rows are treated as non-matching; the other rows are filtered normally',
    fix: (d) => {
      const at = `state.columnFilters["${d.column}"]`
      if (d.source === 'filter') {
        if (!(FILTER_KINDS as readonly string[]).includes(d.filter)) {
          const near = suggest(d.filter, FILTER_KINDS)
          return [
            near.length > 0
              ? `did you mean type: '${near[0]}'? (${at})`
              : `use one of the filter kinds ${FILTER_KINDS.join(', ')} in ${at}`,
          ]
        }
        return [
          `give ${at} a value of type ${d.expected}: { type: '${d.filter}', value: … }`,
          'remove the filter (setColumnFilter(id, undefined)) while there is no value',
        ]
      }
      const out: string[] = []
      const c = convert(d.expected, d.received)
      if (c) {
        out.push(
          `if the filter value is the wrong type, convert it before setting it: ${c.replace('x', 'input')}`,
          `if the data is the wrong type, normalise the column: ` +
            `{ id: '${d.column}', accessor: (row) => ${c.replace('x', 'row.<field>')} } ` +
            `(columns[${d.index}])`,
        )
      } else {
        out.push(
          `normalise the column so every cell is ${d.expected}: an accessor on columns[${d.index}]`,
        )
      }
      out.push(
        `or filter with a kind that fits ${d.received} cells, or a custom filter: ` +
          `{ type: 'custom', value, fn: (cell, value, row) => boolean }`,
      )
      return out
    },
  }),
]
