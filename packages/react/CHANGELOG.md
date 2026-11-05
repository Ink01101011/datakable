# @datakable/react

## 2.1.0

### Minor Changes

- 91c29a0: - Search: a one-word query is matched against each word of a cell by `ex-search`'s `fuzzyMode: 'word'` instead of DataKable's own per-row word split, with the same results and order. A one-typo query longer than 32 characters now matches. (#106)
  - Search keystrokes are cheaper: DataKable no longer splits and scores every cell itself on top of `ex-search` (the per-row word split moved into `ex-search`'s bounded matcher, which still splits each cell into words on each keystroke), and checks the query for spaces once per query instead of once per row. A one-word typo query at 100k rows takes about 30 % less time. (#96)
- 5ff92a2: - A new `data` array on a table sorted by a string column (10,000+ rows) no longer recomputes every collation rank: the strings the column already had keep their ranks and only new strings are placed with the collator, so a one-row `setData` costs a few collator calls and a sort of numbers instead of a cold sort, and the same rows in a new array (e.g. `data={rows.slice()}`) reuse the ranks as they are. (#95)
  - The first sort of a string column makes no second collator pass over the distinct strings to find collator-equal neighbours: equality is recorded from the comparisons the sort already makes, and natively sorted runs are twice as long. (#97)
  - `destroy()` releases the sort caches (collation ranks, the previous order, `sortBy` and key-path values) and the pipeline's column cache, step memo and row keys, so a destroyed table that is still referenced no longer keeps them; its last row model stays readable. (#98)
- 5cc44a5: - `<DataTable />`: body rows are memoised on their row data (`row.original`), index, issues, the `data` array and the `columns` array. Typing in the search box no longer renders every visible cell while the rows have not changed yet (each keystroke rendered all visible cells twice; now only rows that the search result changes render, once), and a parent re-render with the same props renders no cell. A new `data` array or a new `columns` array (e.g. a `cell` renderer memoised on parent state) still renders every visible row again, so a row object changed in place and passed in a new array shows its new values. The server HTML is unchanged. (#99)
  - `onDiagnostic` calls raised while rendering on the server (e.g. `DK_INVALID_PAGINATION`, `DK_DUPLICATE_ROW_KEY`, `DK_SSR_ASYNC_DEFERRED`) are now delivered before `renderToString` returns, instead of in a microtask afterwards, so a server that reads its collected diagnostics right after the render sees all of them. On the client they are still delivered after the commit. (#105)

### Patch Changes

- 0c613a6: - Release workflow: the publish job now runs only after a separate read-only `check` job passes lint, build, typecheck, tests, `check:pkg` and `check:budgets`, and only the publish job holds the write and npm OIDC permissions; the CI workflow runs with a read-only token (`permissions: contents: read`). (#80)
  - CI now runs on Windows as well as Linux, and installs the packed tarballs on Node 18.18 (the `engines.node` floor) to load them as ESM and CJS and server-render `<DataTable />`. The package check scripts work on a stock Windows account (directory junctions instead of symlinks, copied files instead of file symlinks), and `check:rsc` uses `module.registerHooks()` where available instead of the deprecated `module.register()`. (#84)
  - Dev dependencies: `happy-dom` 21.0.4 and `esbuild` 0.28.2 (also for tsup), so `pnpm audit` reports no known vulnerabilities. Consumers were not affected. (#85)
  - `@datakable/core` depends on `ex-search` 1.2.0 (was 1.1.1), which fixes fuzzy search for queries and values longer than 32 characters and bounds the fuzzy tier. (#106)
- e74ebc1: - Docs: every fetcher example (docs pages, error reference and the `datakable` README) builds its request URL with `URLSearchParams` instead of pasting `sort`, `filters` or page params into the string, and the column filters page says that filter values are user input to encode. A docs test now fails on any unencoded `?param=${…}` in the docs, READMEs or their compiled examples. (#101)
  - Docs: the SSR and diagnostics pages say that `onDiagnostic` has every diagnostic raised during a server render by the time `renderToString` returns; the SSR page no longer says they only reach the console. (#105)
- Updated dependencies [0c613a6]
- Updated dependencies [91c29a0]
- Updated dependencies [5ff92a2]
- Updated dependencies [5cc44a5]
- Updated dependencies [e74ebc1]
  - @datakable/core@2.1.0

## 2.0.3

### Patch Changes

- 25413aa: - Bundle-size checks measure every bundle with the inlined package version replaced by a fixed placeholder, so a release version bump can no longer fail them; every size ratchet now keeps at least 64 B of headroom. (#78)
  - Release workflow: npm is pinned to an exact version instead of `npm@latest`, and every GitHub Action in the CI and Release workflows is pinned to a full commit SHA. (#79)
  - A Windows checkout with `core.autocrlf=true` builds, lints and tests again: the repository forces LF line endings (`.gitattributes`), and the core build accepts CRLF sources. (#81)
  - The core build no longer fails when the repository path contains a space or non-ASCII characters, or on Windows paths. (#82)
  - `@datakable/core` no longer ships the test-only `dist/ingest/test-schemas.*` files, and all three packages now include the MIT `LICENSE` file. (#83)
- 543c65c: - A `null` or malformed `columnFilters` / `sorting` slice (e.g. restored from the URL or storage) no longer breaks `setColumnFilter` / `toggleSort` or puts the row model in `'error'`: the features read a malformed slice as empty (valid sort entries are kept); in development the slice is also replaced and reported as the new `DK_INVALID_STATE` (production leaves it in `getState()` unchanged, so app code that reads it should check its shape). DataKable's own state updates are no longer reported as a failing user `updater`. (#89)
  - A `"__proto__"` key (which `JSON.parse` creates as an own key) in `initialState`, `setState`, a controlled `state` or `setColumnFilter` no longer replaces the prototype of the state snapshot or slice: it is dropped and reported as `DK_STATE_UNKNOWN_KEY`. (#102)
  - In development, a deeply nested restored state (for example 10 000 levels) no longer makes `createTable` throw `RangeError`: the snapshot freeze walks it iteratively, and a deeply nested restored sort entry no longer overflows the stack in `setSorting` / `clearSorting` or, in server mode, in `createTable`. (#103)
  - In production builds, a `timeout` of `0`, a negative number or `NaN` now falls back to the 30 s default instead of disabling the timer, and `data: null` counts as no data yet (`isInitialLoad` stays `true`) instead of a loaded empty table. Development still throws `DK_INVALID_OPTION` for both. (#94)
- a567e37: - `table.refetch()` on a `createDeferred` table before `startTable` no longer resolves `{ status: 'applied' }` without fetching: the promise settles with the outcome of the request that runs after `startTable`, or `'superseded'` when the table is destroyed before it starts. (#90)
  - Server mode: restored state is checked before it reaches the fetcher. `FetchParams.sort` holds only `{ id: string, desc: boolean }` entries, and with `columns` an id that names no sortable column is left out (and reported as `DK_STATE_UNKNOWN_KEY` in development). A `pageIndex` / `pageSize` that is not a safe integer (e.g. `1e308`) is replaced before the first request (`DK_INVALID_PAGINATION`). The server-mode docs now say that `FetchParams` are untrusted input for the backend (validate sort ids, cap the page size, encode URL parameters). (#100)
- 67691a8: - Diagnostics: a user value with a `|` in a diagnostic sentence is no longer truncated. A column `sortAlgorithm: 'fast|stable'` now reads `"fast|stable" is not a sort algorithm …`; the same applies to operation, boundary, diagnostic-code and feature method names. (#92)
  - Development console: control characters (C0, C1, DEL) and line breaks in printed diagnostic text are escaped (`\u001b`, `\n`), so a state key or column id from a URL or data can no longer forge a `✖ [DataKable …]` line or send terminal escape sequences. `onDiagnostic` and `getDiagnostics()` still receive the raw values. (#104)
- 0d93802: - `searchFn` results as `{ keys }` now compare as strings, like row keys everywhere else: `['2']` (an id from a JSON API) matches the row whose key is `2`, instead of emptying the table. Keys that match no row are reported in development as the new `DK_SEARCH_UNKNOWN_KEYS` warning (count and a sample, redacted like row keys, `[sensitive]` for a sensitive `rowKey`). (#86)
  - A `NaN` `range` bound, or an `equals` filter with value `NaN`, is now reported as a malformed filter value (`DK_FILTER_TYPE_MISMATCH`, `source: 'filter'`, `received: 'number(NaN)'`) instead of silently filtering out every row. (#91)
- 54bb700: - `<DataTable />`: a Retry after a failed load or refresh now shows Loading (or "Updating…" over the previous rows) with `aria-busy` until the `refetch()` settles, instead of keeping the Error and its Retry button up. Repeat retries while one is in flight are ignored, so one click starts one request, and focus moves to the `<table>` only when the focused Retry button actually unmounts (#87)
  - `<DataTable />`: the `tabindex="-1"` that Retry puts on the `<table>` to hold focus is removed when the table loses focus. A `tabindex` set by the app is left alone (#88)
- b3ac722: - Types: with `strict: false` (precisely `strictNullChecks: false`), `createTable({ data: users, rowKey: 'id' })` and `useDataTable({ data: users, rowKey: 'id' })` no longer fail with TS2322. Without `strictNullChecks`, `undefined` (the "no schema" default) was assignable to `TableSchema`, so every table looked like it had a schema: `data` was typed `unknown[]` and the row type collapsed to `unknown`. The schema check now excludes `undefined` explicitly; `strict: true` inference is unchanged. `check:consumer` now also compiles a `strict: false` consumer, with and without `strictNullChecks`. (#93)
- Updated dependencies [25413aa]
- Updated dependencies [543c65c]
- Updated dependencies [a567e37]
- Updated dependencies [67691a8]
- Updated dependencies [0d93802]
- Updated dependencies [54bb700]
- Updated dependencies [b3ac722]
  - @datakable/core@2.0.3

## 2.0.2

### Patch Changes

- 2fec96b: Diagnostics privacy: a `rowKey` that is (or points into) a `sensitive: true` column is now logged as `[sensitive]` at every level instead of a short hash, since a 32-bit hash of an SSN or email can be recovered by trying candidates. `context.cause` (the original thrown error, which can quote row values) now reaches `onDiagnostic` and the `strict` `DatakableError` only: `getDiagnostics()` returns diagnostics without it, as the docs already promised.
- Updated dependencies [2fec96b]
  - @datakable/core@2.0.2

## 2.0.1

### Patch Changes

- fbdd731: Add npm badges to the package READMEs and broaden package keywords so the packages are easier to find on npm.
- Updated dependencies [fbdd731]
  - @datakable/core@2.0.1

## 2.0.0

### Minor Changes

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
  - @datakable/core@2.0.0

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
- e5e34cc: `<DataTable caption="Customers" />` names its search box "Search Customers" and its pager
  `<nav>` "Customers pagination" (still "Search" / "Pagination" without a text caption), so two
  tables on one page no longer share a control name and a landmark name. Custom `SearchInput` /
  `Pagination` components receive the name as the new `label` prop. Fixes #59.
- 43bd2d3: `styles.css`: the search input's border used `--dk-border` (the table-rule colour), only 1.43:1
  (light) / 1.92:1 (dark) against the background, below WCAG 1.4.11's 3:1 for a control boundary. It
  now uses a new token, `--dk-control-border`: `#818b98` (3.45:1 on `#fff`) and `#6e7681` in the
  dark set (4.12:1 on `#0d1117`). `--dk-border` still draws the table rules. Fixes #58.
- a61b48e: `<DataTable />`: the `⚠` of a cell that failed to render (a throwing `cell` / `format` /
  `invalidCell`, a bad return, or a component that throws inside a cell) is now
  `<span role="img" aria-label="Could not display this value">⚠</span>`, so screen readers say what
  it means instead of reading a bare symbol. Fixes #60.
- 578b419: `<DataTable />`'s default pager marks Previous / Next with `aria-disabled="true"` at the first /
  last page instead of `disabled`: paging to the last page with the keyboard no longer disables the
  focused button and drops focus to `<body>`. The button stays focusable and ignores activation;
  `styles.css` dims `button[aria-disabled="true"]` like `:disabled`. Fixes #55.
- 152abc0: `<DataTable />`: activating Retry (first-load error, refresh error over stale rows, or the render
  error state) unmounted the focused button and dropped keyboard focus to `<body>`. Focus now moves
  to the `<table>` (made focusable with `tabIndex = -1` at that moment) before the button goes away;
  a `retry()` called while focus is elsewhere leaves focus alone. Fixes #56.
- 59b5f7a: `<DataTable />` announces status messages (WCAG 4.1.3): one visually hidden `aria-live="polite"`
  region, present from the first render (and in the server HTML), says "Searching rows…" while a
  search waits or runs and then the result once the table settles ("5 rows", "25 rows, page 2 of 3",
  "0 rows"; server mode "Page 2 of 3"). Before, search results, no results and page changes were
  silent, and the search spinner was an empty `role="status"` with nothing to read; the spinner is now
  decorative (`aria-hidden`). Fixes #54.
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
- d4ffcf9: Fix `<DataTable columns={[...]}>` with an inline columns array never reporting
  `DK_UNSTABLE_COLUMNS` in development: the re-render caused by forwarding the new columns reused
  the same props and reset the count between parent renders. Only renders that bring new options are
  counted now, so `<DataTable>` reports it after two parent re-renders, like `useDataTable`. Fixes #23.
- 169a7f7: Fix `<DataTable />` reading the live table for the sort headers and the pager while hydrating.
  When the table changed during the hydrating render (a table method called in the component body),
  the header (`aria-sort`, ▲) and pager did not match the server HTML, so React discarded it and
  `DK_HYDRATION_MISMATCH` was never reported. They now render from the same snapshot as the rows:
  the server HTML hydrates, `DK_HYDRATION_MISMATCH` names the changed slice, and React re-renders
  with the live table. (A server-mode pager still reads its page count from the table.) Fixes #16.
- 19300fa: A custom `components.SearchInput` or `components.Pagination` that throws no longer unmounts the
  whole React root: `<DataTable />` renders the default part in its place (still bound to the table)
  until another component is passed, and reports `DK_RENDER_FAILED` (`render:table` at
  `components.SearchInput` / `components.Pagination`). Fixes #26.
- 820038c: `<DataTable />` now reports `DK_UNRENDERABLE_VALUE` when it renders a cell whose value the default
  formatter cannot turn into text (an object, a function, an array holding one), on the client and in
  server rendering. Before, only building the search index reported it, so a table without search
  rendered `''` silently. Reported once per column and data. Fixes #18.
- b9cf577: Fix a table leaked per mount by `useDataTable` (and `<DataTable data>`) under React 18's
  development StrictMode: React 18 discards the first mount render with its ref, so that render's
  table was created and never destroyed (`table:init` 2, `table:destroy` 1). The discarded table is
  now destroyed once the render is over. React 19 and production builds are unchanged. Fixes #25.
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
  - @datakable/core@1.1.0

## 1.0.1

### Patch Changes

- 8a6ca7c: Fix `next build --webpack` (and `next dev --webpack`) failing with `It's currently unsupported to
  use "export *" in a client boundary` when a server component imports `@datakable/react`,
  `createTable` from `datakable`, or `datakable/messages` in `app/layout.tsx`. `"use client"` is now
  only on the modules of `<DataTable />` and `useDataTable`, not on `@datakable/react`'s index, so
  `<DataTable />` imported from a server component is still a client component and core's exports
  (`createTable`, …) stay callable on the server. `pnpm check:pkg` now loads the built entries as a
  React server module and fails where Next's webpack build would. Fixes #8.
- Updated dependencies [0395d5c]
- Updated dependencies [f9bc815]
- Updated dependencies [b985a35]
- Updated dependencies [53f8be8]
- Updated dependencies [1d94455]
- Updated dependencies [e7d5cf2]
- Updated dependencies [77743f5]
  - @datakable/core@1.0.1

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
