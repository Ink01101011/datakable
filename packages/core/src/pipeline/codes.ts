import { defineDiagnostic } from '../diagnostics/catalog'

declare module '../diagnostics/catalog' {
  interface DiagnosticCatalog {
    DK_UNRENDERABLE_VALUE: {
      /** Column id (`key` or `id`). */
      column: string
      /** Position in `options.columns`. */
      index: number
      /** How many cells could not be rendered. */
      count: number
      /** A sample of the row indices (first few, in order). */
      rows: readonly number[]
      /** The type of the first unrenderable value: `object`, `array` or `function`. */
      valueType: string
    }
  }
}

const rowList = (rows: readonly number[], count: number) => {
  const list = rows.map((r) => `#${r}`).join(', ')
  return count > rows.length ? `first: ${list}, …` : `rows ${list}`
}

/** Codes owned by the pipeline / column cache (§4.3, §8.3). */
export const pipelineDiagnostics = [
  defineDiagnostic({
    code: 'DK_UNRENDERABLE_VALUE',
    level: 'warn',
    where: (d) => ({ kind: 'column', index: d.index, id: d.column }),
    problem: (d) =>
      `column "${d.column}" has ${d.count === 1 ? '1 value' : `${d.count} values`} of type ` +
      `${d.valueType} (${rowList(d.rows, d.count)}) that the default formatter cannot render`,
    impact: () => "those cells render '' (and match no search)",
    fix: (d) => [
      `give columns[${d.index}] a format: (value) => string, e.g. format: (v) => v.name`,
      `or render it yourself with cell: ({ value }) => … on columns[${d.index}]`,
      `or point the column at a primitive field: key: '${d.column}.<field>'`,
    ],
  }),
]
