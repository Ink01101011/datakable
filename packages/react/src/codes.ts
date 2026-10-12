import { defineDiagnostic } from '@datakable/core'

declare module '@datakable/core' {
  interface DiagnosticCatalog {
    DK_UNSTABLE_COLUMNS: {
      /** Consecutive renders that passed a new `columns` array with the same shape. */
      renders: number
    }
    DK_UNSTABLE_OPTION: {
      /** `data`, `fetcher`, `rowKey`, or a feature's function option: `features[2].searchFn`. */
      option: string
      /** Consecutive renders that passed a new reference. */
      renders: number
    }
  }
}

const isFeatureOption = (option: string) => option.startsWith('features[')

/** Codes owned by `@datakable/react` (§8.3, react, dev only). */
export const reactDiagnostics = [
  defineDiagnostic({
    code: 'DK_UNSTABLE_COLUMNS',
    level: 'warn',
    where: () => ({ kind: 'option', path: 'columns' }),
    problem: (d) =>
      `useDataTable received a new columns array with the same shape on ${d.renders} renders ` +
      'in a row (columns are compared by reference)',
    impact: () =>
      'each new array rebuilds the column cache and re-runs the pipeline; in a re-render caused ' +
      'by the table itself, the columns the table already has are kept',
    fix: () => [
      'define the columns outside the component, or memoise them: ' +
        'useMemo(() => [...columns], [the values they read])',
      'a new columns array is how you tell the table the columns changed (accessor / format / ' +
        'cell), so create one only when they do',
    ],
  }),
  defineDiagnostic({
    code: 'DK_UNSTABLE_OPTION',
    level: 'warn',
    where: (d) => ({ kind: 'option', path: d.option }),
    problem: (d) =>
      `useDataTable received a new ${d.option} reference on ${d.renders} renders in a row`,
    impact: (d) =>
      d.option === 'fetcher'
        ? 'the table always calls the latest fetcher, but a new fetcher does not refetch: ' +
          'values it reads that are not table state do not reload the data'
        : d.option === 'data'
          ? 'each new array is ingested again (schema, data checks, pipeline); in a re-render ' +
            'caused by the table itself an equal array is skipped'
          : isFeatureOption(d.option)
            ? 'features are read once, when the table is created: the table keeps calling the ' +
              `${d.option} of the first render (a stale closure)`
            : 'each new rowKey function recomputes every row key',
    fix: (d) =>
      d.option === 'fetcher'
        ? [
            'call table.refetch() when a value the fetcher reads changes (or keep that value in ' +
              'a server-mode feature state, which refetches by itself)',
            'wrap the fetcher in useCallback to silence this warning',
          ]
        : d.option === 'data'
          ? [
              'memoise derived data: useMemo(() => rows.filter(...), [rows])',
              'or keep the data in state and pass the same array until it changes',
            ]
          : isFeatureOption(d.option)
            ? [
                'create the features once: useMemo(() => [search({ searchFn })], []) or outside ' +
                  'the component',
                'read changing values inside the function through a ref (ref.current) instead ' +
                  'of the render closure',
              ]
            : [
                "use a key path (rowKey: 'id') or a function defined outside the component",
                'or wrap it in useCallback',
              ],
  }),
]
