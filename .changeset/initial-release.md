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
  `explainRow(key)`; interceptors over every operation.
- `@datakable/react`: `useDataTable`, a `useSyncExternalStore` binding that syncs options in a
  layout effect and warns about unstable `columns` in development.
- `datakable`: `useDataTable` and `createTable` with the default preset, `datakable/core` and
  `datakable/messages`.

Core reads `process.env.NODE_ENV`; browser builds need a bundler that replaces it.
