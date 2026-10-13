# @datakable/core

## 1.0.1

### Patch Changes

- 0395d5c: Fix `next build` failing under Next 16 `cacheComponents` ("encountered the unstable value
  `Date.now()`") when a table reports a diagnostic while it renders, e.g. a duplicate row key
  (`DK_DUPLICATE_ROW_KEY`) or a fetcher deferred on the server (`DK_SSR_ASYNC_DEFERRED`). The
  diagnostics clock (`context.occurrences.first` / `last`, the console rate limit) now reads
  `performance.timeOrigin + performance.now()`, which Next reserves for introspection, instead of
  `Date.now()`; it is still epoch milliseconds, and falls back to `Date.now()` where `performance`
  is missing. Fixes #7.
- f9bc815: Fix tables with features throwing `options.features is set but no feature runtime is loaded`
  when the app is bundled with `esbuild --minify` (the documented production command). The feature
  runtime is now installed by calling `defineFeature()` (every built-in feature does), not only by
  a top-level statement that esbuild dropped after inlining `defineFeature` into its callers. This
  covers `datakable`'s `createTable`, `useDataTable` and `<DataTable />` (default preset).
  `pnpm size` now also runs every bundle it measures and fails when one does not work. Fixes #5.
  
  New §9.3 size budgets (gzip, `pnpm size`) for the entries with features, set at the measured sizes
  of bundles that now run: the earlier budgets were measured on bundles that threw (#5). Core +
  `columnFilters` + `sorting` + `pagination` ≤ 24 KB (was 22 KB); `datakable` `createTable` ≤ 27 KB
  (was 24.5 KB), `useDataTable` ≤ 28.5 KB (was 26.5 KB), `<DataTable />` ≤ 31.5 KB (was 29.5 KB).
  Core `createTable` stays ≤ 15 KB.
- b985a35: Fix `pagination({ pageSize })` with `0`, `NaN`, a negative or a non-integer size in a production
  build: the table no longer recurses until the stack overflows (`DK_INTERCEPTOR_FAILED`) and shows
  0 rows. The invalid size is replaced by the default (10) and reported once as
  `DK_INVALID_PAGINATION` (`where: { kind: 'feature', name: 'pagination' }`, with a fix when
  `@datakable/core/messages` is installed). Development builds still throw `DK_INVALID_OPTION` at
  creation. Fixes #13.
- 53f8be8: Fix `row.getValue()`, `row.valid`, `row.issues` and `row.getCellIssues()` throwing
  `TypeError: Cannot read private member #source` when the row model sits in a proxy-based store
  (Vue `ref()` / `reactive()`, Pinia state, MobX): the row kept its internals in a `#private` field,
  and those stores call getters and methods with `this` set to their proxy, which has no private
  slot. A row now keeps them under an unexported symbol key, which reads through any proxy and
  stays out of `Object.keys` and JSON; a row still costs the same four fields. Fixes #11.
- 1d94455: Fix `setSearch()` / `flushSearch()` resolving `{ status: 'applied' }` while the row model was
  still `'pending'` (unfiltered) on large data, where the built-in search builds its index and
  matches in time slices. The promise now resolves `'applied'` once a row model that reflects the
  query has been computed (status no longer `'pending'`), and `'superseded'` when a newer query,
  `cancelSearch()` or `destroy()` interrupts that work. Fixes #6.
- e7d5cf2: Fix the built-in search never matching a typo against one word of a multi-word cell
  (`lopes` → `Garcia Lopez`, `jose` → `José García`) at any `threshold`: ex-search measures the
  edit distance to the whole value. A one-word query is now measured against each word of the
  cell as well as the whole cell (up to `fuzzyMaxDistance` edits); a query with spaces is still
  measured against the whole cell, and exact / prefix / substring matches score as before.
  Fixes #10.
- 77743f5: Fix a server-rendered table sorted by a text column hydrating in a different row order (React
  error #418) when the browser's locale differs from the server's: `sorting()` without `locale`
  compared strings with the runtime's default locale. The default is now `'en'` on the server and
  in the browser; pass `sorting({ locale })` (the same value on both sides) to sort in another
  language. Fixes #12.

## 1.0.0

### Major Changes

- d8ceef5: DataKable 1.0.0: the first stable release of the core API. The public API (exports, options,
  `DK_*` codes and their meaning) follows semantic versioning from this version.
  
  - `@datakable/core`: headless table store (`createTable`) with immutable snapshots, controlled
    state slices and isolated listeners; the feature contract (`defineFeature`) and the built-in
    `columnFilters`, `validity`, `search`, `sorting` and `pagination` features, each with its own
    entry point (`@datakable/core/sorting`, …) and a `defaultFeatures` preset; typed dot-path
    columns, derived columns and zero-config column derivation; Standard Schema validation with
    `invalidRows: 'drop' | 'flag' | 'throw'` (`schema: withSchema(UserSchema)`); client / server
    mode per feature with a `fetcher` (`fetcher: withFetcher(fetchUsers)`; latest wins, abort,
    timeout) and `refetch()`; client fuzzy search, or an async `searchFn`
    (`search({ searchFn: withSearchFn(fn) })`); a row model with `status` and `isInitialLoad`
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
    Empty states and `components` overrides; an error boundary with a per-cell fallback
    (`DK_RENDER_FAILED`: a throwing cell shows ⚠, the table survives); an optional stylesheet,
    `@datakable/react/styles.css` (not importing it adds no CSS).
  - `datakable`: `useDataTable`, `createTable` and `<DataTable />` with the default preset,
    `datakable/core`, `datakable/messages` and `datakable/styles.css`.
  
  Bundle-size opt-ins (spec §9.3, decided 2026-10-13 — these change the API described in earlier
  drafts of the spec):
  
  - `schema` takes only a Standard Schema wrapped with `withSchema()` from `@datakable/core/schema`;
    `fetcher` only a function wrapped with `withFetcher()` from `@datakable/core/server`; `searchFn`
    only a function wrapped with `withSearchFn()` from `@datakable/core/search-async`. All three are
    also exported from `@datakable/core` (and `datakable`). A raw value is a compile error and
    `DK_INVALID_OPTION` in every build (development: the option validator with the full text;
    production: a small guard), never ignored silently.
  - New entry points: `@datakable/core/schema`, `@datakable/core/server`,
    `@datakable/core/search-async`. A table without a schema / fetcher / `searchFn` bundles none of
    that code.
  - The `merge` sort algorithm was removed; use `tim` (stable, comparator-based) instead.
  - Option validation (unknown / invalid / no-effect options, did-you-mean), feature option schemas,
    version and dependency-compatibility checks (`DK_DEP_INCOMPATIBLE`) and the data checks run in
    development only. Production keeps read-once options on `setOptions` and the unwrapped-option
    guard above.
  - Size budgets (gzip, `pnpm size`): core `createTable` ≤ 15 KB; core + `columnFilters` +
    `sorting` + `pagination` ≤ 22 KB; `datakable` `createTable` ≤ 24.5 KB, `useDataTable` ≤ 26.5 KB,
    `<DataTable />` ≤ 29.5 KB. Pipeline memory ≤ 5 MB in every 100k-row scenario.
  
  Every `DK_*` code has a section in `docs/errors.md` (problem, common causes, fix, example).
  Documentation starts at `docs/README.md`: guides (how to use), examples and troubleshooting (how to
  fix); every TypeScript block in it is a compiled example.
  
  Core reads `process.env.NODE_ENV`; browser builds need a bundler that replaces it.
