---
'@datakable/core': minor
'@datakable/react': minor
'datakable': minor
---

First release of the DataKable core API.

- `@datakable/core`: headless table store (`createTable`) with immutable snapshots, controlled
  state slices and isolated listeners; the feature contract (`defineFeature`) and the built-in
  `columnFilters`, `validity`, `search`, `sorting` and `pagination` features, each with its own
  entry point (`@datakable/core/sorting`, …) and a `defaultFeatures` preset; typed dot-path
  columns, derived columns and zero-config column derivation; Standard Schema validation with
  `invalidRows: 'drop' | 'flag' | 'throw'`; client / server mode per feature with a `fetcher`
  (latest wins, abort, timeout) and `refetch()`; a row model with `status` and `isInitialLoad`
  that always notifies on change; diagnostics with stable `DK_*` codes, redaction, sinks and
  production text stripping (`@datakable/core/messages` opts back in); `explain()` and
  `explainRow(key)`; interceptors over every operation; time-sliced search indexing / matching and
  string sorts on large data (`status: 'pending'`, `scheduler.yield` with a `setTimeout` fallback);
  SSR support: `initialData`, `createDeferred` / `startTable`, `DK_SSR_ASYNC_DEFERRED`,
  `DK_HYDRATION_MISMATCH`, `DK_STATE_UNKNOWN_KEY`.
- `@datakable/react`: `useDataTable`, a `useSyncExternalStore` binding that syncs options in a
  layout effect, warns about unstable `columns` in development, renders on the server (async work
  starts after hydration) and reports hydration mismatches; `<DataTable />`, a zero-config,
  unstyled table with sort headers (`aria-sort`), search input, pagination, Loading / Error /
  Empty states and `components` overrides.
- `datakable`: `useDataTable`, `createTable` and `<DataTable />` with the default preset,
  `datakable/core` and `datakable/messages`.

Core reads `process.env.NODE_ENV`; browser builds need a bundler that replaces it.
