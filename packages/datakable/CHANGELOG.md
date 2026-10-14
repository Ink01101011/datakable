# datakable

## 2.0.0

### Major Changes

- e5c460b: **Breaking:** the `datakable` root entry is framework-free; the React API moved to `datakable/react` (Fixes #63).
  
  - `datakable` exports `createTable` with the default preset and everything from `@datakable/core`. It imports no React, so `import 'datakable'` (and `datakable/core`, `datakable/messages`) works in a project without React installed, and in plain Node.js with `--conditions=react-server`.
  - `datakable/react` (new) exports everything `datakable` does, plus `useDataTable` and `<DataTable />` with the default preset and the rest of `@datakable/react`. Only the hook and component modules are `"use client"`, as before.
  - `react` is now an optional peer dependency of `datakable` and `@datakable/react` (`peerDependenciesMeta`), so npm and pnpm no longer install React for a project that only uses the framework-free entries.
  - `@datakable/react/messages` (new): the production diagnostic text of core and `<DataTable />`, without importing React. `datakable/messages` now uses it.
  
  `core`, `react` and `datakable` are one fixed version group, so this major bump releases all three as 2.0.0. `@datakable/core` and `@datakable/react` keep their imports; only `datakable`'s React imports change.
  
  **Migration:** in a React app, import the hook, the component and their types from `datakable/react`. It is a superset of the root, so replacing `from 'datakable'` with `from 'datakable/react'` in every import is enough:
  
  ```diff
  - import { DataTable, useDataTable, type DataTableProps } from 'datakable'
  + import { DataTable, useDataTable, type DataTableProps } from 'datakable/react'
  ```
  
  Names that left the root: `useDataTable`, `DataTable`, `UseDataTableOptions`, `UseDataTableResult`, `DataTableProps`, `DataTableOwnProps`, `DataTableSource`, `DataTableComponents`, `SearchInputProps`, `PaginationProps`, `EmptyProps`, `LoadingProps`, `ErrorProps`, `cellSlot`, `invalidCellSlot`, `reactDiagnostics`, `renderDiagnostics`, `renderMessages`. Full note: docs/how-to-use/entry-points.md#migrating-from-1x.

### Patch Changes

- Updated dependencies [41e9845]
- Updated dependencies [e5c460b]
  - @datakable/core@2.0.0
  - @datakable/react@2.0.0

## 1.1.0

### Minor Changes

- 00ff267: Smaller production bundles: diagnostic details that are sentences in development (`fallback`,
  `reason`, `problem`, `expected`) are now short keys in production, e.g.
  `fallback: 'cells-undefined'` instead of `'the failed cells read as undefined'`, or
  `reason: 'page-size|10'` (a key and its arguments) instead of `'pageSize was replaced by 10'`.
  Codes, `where`, levels and every other detail are unchanged, and development builds read exactly
  as before. To get the sentences back in production, import the messages once in the app entry:
  `import 'datakable/messages'` (or `@datakable/core/messages`); the details then read exactly as in
  development. The keys are listed in `packages/core/src/diagnostics/prose.ts`.

### Patch Changes

- 7090c8d: `styles.css` no longer fades the stale rows to `opacity: 0.6` while the table is busy over them
  (refresh, server or debounced search): that dropped body text to 4.24:1 in the light theme (WCAG
  1.4.3 needs 4.5:1), and flagged cells to 2.59:1. The rows keep full contrast; the "Updating…"
  indicator signals the refresh and the rows get `cursor: progress`. Fixes #57.
- 43bd2d3: `styles.css`: the search input's border used `--dk-border` (the table-rule colour), only 1.43:1
  (light) / 1.92:1 (dark) against the background, below WCAG 1.4.11's 3:1 for a control boundary. It
  now uses a new token, `--dk-control-border`: `#818b98` (3.45:1 on `#fff`) and `#6e7681` in the
  dark set (4.12:1 on `#0d1117`). `--dk-border` still draws the table rules. Fixes #58.
- 622333f: New development-only warning `DK_CONTROLLED_SLICE_DROPPED`: feeding a change back with only the
  slice that changed (`table.setOptions({ state: { sorting } })`) while you control several slices
  used to release the others silently, because `setOptions` replaces the whole `state` option. It
  now names the dropped slice and the fix (`setOptions({ state: { ...current, sorting } })`, or pass
  the slice as `undefined` to release it on purpose). Deliberate releases (`state: {}`, an explicit
  `undefined`, React's `state` prop dropping a slice outside a feed-back) stay silent. Nothing changes
  in production builds. Fixes #49.
- c2509da: Documentation fixes from the 1.0.0 production validation (no code change):
  
  - Next.js app router: import `datakable/messages` from a `'use client'` module rendered by the
    root layout; an import in `app/layout.tsx` (a server component) never reaches the browser.
    Fixes #15.
  - `docs/examples/nextjs-ssr.md` and the SSR guide load the page's data inside `<Suspense>`, so
    the recipe builds with Next 16 `cacheComponents`. Fixes #17.
  - Server mode: `filteredCount` and `totalCount` count the loaded page; keep the fetcher result's
    `rowCount` for the server's total (new "Counting rows in server mode" section). Fixes #31.
  - `createTable<Row>({ features })` is a compile error, not silently un-inferred features; the
    printed error and its two fixes are in "Reading type errors" (section 7). Fixes #39.
  - A server that is not bundled (Node, Nuxt/Nitro `node-server`) needs `NODE_ENV=production` at
    run time, or it reports in development mode with raw row keys. Fixes #47.
  - Nuxt / Nitro drops a side-effect-only `import '@datakable/core/messages'` from the server
    bundle: install the text with `installMessages(...allMessages)` from a universal plugin.
    Fixes #48.
  - `setOptions({ state })` replaces the whole `state` option: feed back every controlled slice.
    Fixes #49.
  - A feature's option is reported at `feature "<name>"` with the option in `details.path`, not as
    `options.<feature>.<option>`. Fixes #50.
  - SSR with `data` and an async `searchFn` for an initial query lists the rows unsearched
    (`data-status="pending"`), not the Loading state. Fixes #51.
  
  Also documented: development freezes arrays passed as filter values; `setSorting` compares
  entries as JSON (key order matters); zero-config search covers only string, number and boolean
  columns (`DK_SEARCH_COLUMN_SKIPPED` otherwise).
- 8f79b5b: Packaging and type-resolution fixes:
  
  - The `./styles.css` exports of `datakable` and `@datakable/react` now carry a `types` condition
    (an empty declaration per module format), so `import 'datakable/styles.css'` type-checks under
    TypeScript 6, which checks side-effect imports by default. Fixes #34.
  - A `typesVersions` fallback maps every subpath entry (`datakable/core`, `datakable/messages`,
    `@datakable/core/pagination`, …, and the stylesheets) for `moduleResolution: node10`, which ignores
    `exports`. Fixes #33.
  - All three packages declare `engines.node: ">=18.18.0"` (the floor set by the runtime dependency
    `kk-debounce`; the code itself targets ES2022). Fixes #37.
  - The minimum TypeScript version, 5.4 (the types use `NoInfer`), is now documented, and the
    published declarations are checked against it. Fixes #32.
  - Every published `.js` / `.cjs` file carries exactly one `sourceMappingURL` comment (fixed in
    1.0.1, now checked on every build). Fixes #35.
- Updated dependencies [7090c8d]
- Updated dependencies [e5e34cc]
- Updated dependencies [43bd2d3]
- Updated dependencies [a61b48e]
- Updated dependencies [578b419]
- Updated dependencies [152abc0]
- Updated dependencies [59b5f7a]
- Updated dependencies [f4e1b7e]
- Updated dependencies [337d557]
- Updated dependencies [3c9826d]
- Updated dependencies [622333f]
- Updated dependencies [c2509da]
- Updated dependencies [b5752d4]
- Updated dependencies [8f79b5b]
- Updated dependencies [825a969]
- Updated dependencies [b8d1e6c]
- Updated dependencies [00ff267]
- Updated dependencies [d4ffcf9]
- Updated dependencies [169a7f7]
- Updated dependencies [19300fa]
- Updated dependencies [820038c]
- Updated dependencies [b9cf577]
- Updated dependencies [4879542]
- Updated dependencies [addbf66]
- Updated dependencies [7729717]
- Updated dependencies [44ce4bc]
- Updated dependencies [b61ee10]
- Updated dependencies [2080355]
- Updated dependencies [e3b6d3b]
- Updated dependencies [9b693a6]
- Updated dependencies [3082297]
- Updated dependencies [66d10d6]
- Updated dependencies [33a0d32]
- Updated dependencies [55ad4bd]
- Updated dependencies [91b163e]
- Updated dependencies [6fc764f]
- Updated dependencies [33a0d32]
- Updated dependencies [760c769]
  - @datakable/react@1.1.0
  - @datakable/core@1.1.0

## 1.0.1

### Patch Changes

- ca17b72: Fix `createTable` from `datakable` bringing React along: the package was one file, so a bundle
  that used only `createTable` still contained React (and kept `import 'react'` with React external),
  a Next.js server component that only called `createTable` shipped about 19 KB gzip of table code
  to the browser (Turbopack), and `<DataTable />` from `datakable` in a server component failed the
  build with `(0 , e.useRef) is not a function`. `datakable` is now published one file per module,
  like `@datakable/core` and `@datakable/react`, and only the modules of `<DataTable />` and
  `useDataTable` are marked `"use client"`: a `createTable`-only bundle has no React, a server
  component can render `<DataTable />` with plain data props, and `useDataTable` called on the
  server gets Next's `Attempted to call useDataTable() from the server`. The public imports are
  unchanged. `pnpm check:pkg` now loads `datakable` as a React server module and bundles
  `createTable` alone, and fails if React is in that bundle. Fixes #9.
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
- 8a6ca7c: Fix `next build --webpack` (and `next dev --webpack`) failing with `It's currently unsupported to
  use "export *" in a client boundary` when a server component imports `@datakable/react`,
  `createTable` from `datakable`, or `datakable/messages` in `app/layout.tsx`. `"use client"` is now
  only on the modules of `<DataTable />` and `useDataTable`, not on `@datakable/react`'s index, so
  `<DataTable />` imported from a server component is still a client component and core's exports
  (`createTable`, …) stay callable on the server. `pnpm check:pkg` now loads the built entries as a
  React server module and fails where Next's webpack build would. Fixes #8.
- Updated dependencies [0395d5c]
- Updated dependencies [f9bc815]
- Updated dependencies [8a6ca7c]
- Updated dependencies [b985a35]
- Updated dependencies [53f8be8]
- Updated dependencies [1d94455]
- Updated dependencies [e7d5cf2]
- Updated dependencies [77743f5]
  - @datakable/core@1.0.1
  - @datakable/react@1.0.1

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

### Patch Changes

- Updated dependencies [d8ceef5]
  - @datakable/core@1.0.0
  - @datakable/react@1.0.0
