# Examples

A cookbook of complete recipes: each page solves one common table task end to end, with code you
can copy. Every TypeScript block is a compiled file, and a test renders or runs each recipe, so
the recipes match the released API and do what their page says.

## Recipes

Getting a table on screen:

- [A zero-config table from an array](zero-config.md) — `<DataTable data />`, and the same table
  headless with `createTable`.
- [Custom columns](custom-columns.md) — headers, `format`, `cell` renderers, nested dot-paths, a
  derived column, `sensitive`.
- [A headless table with your own markup](headless-table.md) — `useDataTable` with your own
  search box, column filter, sort headers and pager.
- [Theming](theming.md) — `datakable/styles.css`, the `--dk-*` variables and dark mode.

Data from a server:

- [A server-side table](server-side-table.md) — a `fetcher`, with loading, refresh, error and
  retry UI from `status` and `isInitialLoad`.
- [Search through an API](async-search.md) — `withSearchFn` with a debounce.
- [Server rendering with Next.js](nextjs-ssr.md) — the app router: fetch on the server, hydrate
  with `initialData`.

State and data quality:

- [Validate rows with a schema](schema-validation.md) — `invalidRows: 'flag'`, an `invalidCell`
  renderer and a "show invalid" toggle.
- [Keep the table's state in the URL](url-state.md) — controlled search, sorting and pagination
  synced with the query string.
- [Large data](large-data.md) — 100,000 rows on the client, and what keeps them fast.

Extending DataKable:

- [A custom feature: row selection](row-selection-feature.md) — `defineFeature` with a typed
  state slice and API.
- [A logging and analytics interceptor](logging-interceptor.md) — `defineInterceptor` around user
  actions, pipeline runs and requests.
- [Report diagnostics to an error tracker](error-reporting.md) — `onDiagnostic` to a
  Sentry-style client, redacted.

## See also

- [How to use](../how-to-use/README.md) — the guides behind each recipe.
- [How to fix](../how-to-fix/README.md) — when a recipe prints a diagnostic.
- [Documentation index](../README.md)
