# How to use

Guides to DataKable's API, one topic per page: what the option or method is for, how to use it,
and what to watch out for. Start with [Getting started](getting-started.md); the package READMEs
([`datakable`](../../packages/datakable/README.md),
[`@datakable/react`](../../packages/react/README.md),
[`@datakable/core`](../../packages/core/README.md)) stay the short API reference.

## Pages

### Basics

- [Getting started](getting-started.md) — install, the zero-config table, which package to import,
  and the bundler requirement.
- [Core concepts](core-concepts.md) — the table object, the pipeline, the row model, `Row`, the
  status model and every `createTable` option.
- [State](state.md) — snapshots, `setState`, `subscribe`, `initialState` and controlled slices.
- [Columns and row keys](columns-and-row-keys.md) — dot-path keys, derived columns, `cell` and
  `format`, sensitive columns and `rowKey`.

### Features

- [Features](features.md) — the default preset, choosing features, pipeline order and data modes.
- [Column filters](column-filters.md) — `columnFilters()`: `equals`, `contains`, `in`, `range` and
  `custom`.
- [Search](search.md) — `search()`: fuzzy matching, search weights, typing strategies and
  `withSearchFn`.
- [Sorting](sorting.md) — `sorting()`: multi-column sort, the comparator, `sortFn` / `sortBy` and
  the sort algorithms.
- [Pagination](pagination.md) — `pagination()`: page size, page index, auto-reset and server
  paging.
- [Validity](validity.md) — `validity()`: show all, valid or invalid rows of a schema-checked table.

### Data

- [Server mode](server-mode.md) — `mode: 'server'`, `withFetcher`, `rowCount`, `refetch()` and the
  async statuses.
- [Schema validation](schema-validation.md) — `withSchema`, `invalidRows` and cell issues.

### React and rendering

- [React](react.md) — `useDataTable`, `<DataTable />`, `components`, `styles.css` and the `data-*`
  hooks.
- [Server rendering (SSR)](ssr.md) — `initialState`, `initialData`, `createDeferred` /
  `startTable` and hydration.

### Debugging and extending

- [Diagnostics](diagnostics.md) — `onDiagnostic`, redaction, production text, `explain()` /
  `explainRow()` and the tracer.
- [Custom features and interceptors](custom-features-and-interceptors.md) — `defineFeature`,
  `defineOptions` and `defineInterceptor`.
- [Performance](performance.md) — the budgets, time-slicing, memory and keeping bundles small.
- [Entry points](entry-points.md) — every import path and what it brings.

## See also

- [Examples](../examples/README.md) — complete recipes.
- [How to fix](../how-to-fix/README.md) — diagnostics and type errors.
- [Documentation index](../README.md)
