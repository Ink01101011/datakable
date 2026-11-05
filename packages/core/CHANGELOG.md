# @datakable/core

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

## 2.0.2

### Patch Changes

- 2fec96b: Diagnostics privacy: a `rowKey` that is (or points into) a `sensitive: true` column is now logged as `[sensitive]` at every level instead of a short hash, since a 32-bit hash of an SSN or email can be recovered by trying candidates. `context.cause` (the original thrown error, which can quote row values) now reaches `onDiagnostic` and the `strict` `DatakableError` only: `getDiagnostics()` returns diagnostics without it, as the docs already promised.

## 2.0.1

### Patch Changes

- fbdd731: Add npm badges to the package READMEs and broaden package keywords so the packages are easier to find on npm.

## 2.0.0

### Patch Changes

- 41e9845: A diagnostic detail written as a prose key with a placeholder but without its argument (for example `fallback: 'page-size'`) no longer throws while the diagnostic is built; the missing argument reads as an empty string.

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

- f4e1b7e: Fix the text of `DK_COLUMN_PATH_NOT_FOUND` when one row was checked or no key is close: it read
  "does not exist in any of the first row" and the fix list started with "or compute the value".
  It now reads "does not exist in the first row" ("in any of the first N rows" for more), and the
  "or" is kept only after a suggested key. Fixes #44.
- 337d557: Column paths and `rowKey` paths no longer read inherited `Object.prototype` members: a key such as
  `constructor`, `toString` or `__proto__` (or an inherited method like an array's `map`) reads
  `undefined` unless the row has it as its own property, so `DK_COLUMN_PATH_NOT_FOUND` /
  `DK_MISSING_ROW_KEY` are reported instead of a function being shown as a value. Class getters
  still work. Fixes #42.
- 3c9826d: Fix development diagnostics never printing on runtimes whose console has no
  `groupCollapsed` / `groupEnd`, such as the Edge Runtime (Next.js `middleware.ts`, Vercel Edge):
  the first print failed with `console.groupCollapsed is not a function` and every later one was
  dropped. The development sink now prints the same header and body as one `console.error` /
  `warn` / `info` call there. Fixes #53.
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
- b5752d4: Fix the false `DK_DUPLICATE_CORE` error when one installed version of `@datakable/core` is
  evaluated more than once in a process: its ESM and CJS builds both loaded, the layers of a
  Next.js dev server (RSC, SSR, route handlers), or a hot reload. With `strict: true` that error was
  thrown (a Next.js route returned 500). `DK_DUPLICATE_CORE` is now reported only when the loaded
  copies have different versions. Copies of one version report the new
  `DK_DUPLICATE_CORE_SAME_VERSION`, an info shown once per session (development only, never thrown
  by `strict`), which explains that `instanceof DatakableError` does not hold across the copies and
  to compare `err.code` instead. Fixes #14.
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
- 825a969: Fix a restored `pagination.pageIndex` past the last page (`initialState` / controlled `state`)
  staying in the state: the table showed the last page while `getState().pagination.pageIndex` kept
  the restored value, so a pager built from the state read "Page 100 of 3". The index is now clamped
  at creation against the data (server mode: a known `rowCount`), without running the pipeline early;
  restored filters that leave fewer rows are clamped on the first update as before. Fixes #19.
- b8d1e6c: Loading `@datakable/core` where `process.env.NODE_ENV` was not replaced and `process` does not
  exist (a page without a bundler: CDN, import map) now throws
  `ReferenceError: [DataKable] process is not defined: replace process.env.NODE_ENV at build time …`
  with the fix and a link to docs/how-to-fix/process-is-not-defined.md, instead of the engine's
  bare `process is not defined` from an internal file. The check lives in a small module every
  reader of the flag imports first; a production bundle removes it (bundle sizes unchanged), and
  `pnpm build` now verifies the ESM and CJS builds throw this error without `process`. Fixes #36.
- 4879542: `rowKey`: a generated fallback key (`key#n` for a duplicate, `#index` for a missing key) no longer
  takes the real, unique key of a later row. Keys are now assigned in two passes: every real key
  first, then the fallbacks, which skip every taken key. Data ids `['1', '1', '1#1']` now get keys
  `['1', '1#2', '1#1']`, and `explainRow('1#1')` finds the row whose key really is `'1#1'`. Fixes #29.
- addbf66: `rowKey`: keys are now compared as strings, the identity React keys and `explainRow` use, so `1`
  and `'1'` are a duplicate: the later row gets `1#1` and `DK_DUPLICATE_ROW_KEY` is reported
  (before, both rows kept their keys and `<DataTable>` rendered two rows with the same React key).
  Fields suggested by the fix are checked the same way. Fixes #24.
- 7729717: search: with `typing: { strategy: 'debounce', behavior: 'leading' }`, the `setSearch()` promise of a keystroke the leading debounce drops now settles `'superseded'` when the silence window ends (it stayed pending until the next `setSearch`). `flushSearch()` within the window still applies it.
  
  Fixes #28
- 44ce4bc: search: less memory for client search over zero-config (or `format`-less) columns. A searchable column of strings, numbers (including `null` / `undefined` / `NaN` cells), number | string mixes or booleans no longer keeps a formatted string per row: it is stringified while matching. Columns that still keep formatted strings (with `format`, dates, arrays) share repeated strings. At 100k rows, a zero-config search over five such columns drops from 9.05 MB to 4.56 MB (budget ≤ 5 MB), and over the ten mixed columns of the report from ~18.9 MB to ~12.2 MB (Node, production build). The performance guide now says what search keeps.
  
  Refs #27 (first part; `search-primitives-only-default` completes it: the ten-column zero-config shape is now within budget)
- b61ee10: search: zero-config client search covers the columns of primitives only.
  
  **Behaviour change:** when no column declares a `search` weight (zero-config columns included), search matches the columns of strings, numbers and booleans (nullable) only; a column of dates, arrays or other objects is no longer searched unless it opts in with a `search` weight (e.g. `columns: [{ key: 'name', search: 1 }, { key: 'joined', search: 1 }]`; once one column declares a weight, only weighted columns are searched, as before). Formatting such a column kept a string per row. Development builds report the new `DK_SEARCH_COLUMN_SKIPPED` (info, dev only: no production bytes) for each skipped column, with the opt-in as the fix.
  
  search memory: a searchable key column of strings, numbers or booleans without `format` is now read from the rows while matching, so search keeps no values array for it (a read that throws still goes through the column cache, which reports it). At 100k rows (Node, production build) a zero-config search over the ten mixed-type fields of the report now adds 1.48 MB (was 12.61 MB; budget ≤ 5 MB), and the filter + sort + search scenario 2.00 MB (was 3.50 MB).
  
  Fixes #27
- 2080355: Fix a search slice restored with `status: 'pending'` or `'searching'` (`initialState`, `setState`
  or a controlled `state`, e.g. from the URL or storage) keeping the row model in that status
  forever: nothing was scheduled to finish it. When no typing commit or `searchFn` request is in
  flight, a restored `'pending'` now commits its `input` (with `commitOn: 'enter'` the input stays
  uncommitted) and a restored `'searching'` ends; the status becomes `'idle'`, and with a `searchFn`
  the applied query is searched again. Fixes #22.
- e3b6d3b: search: building the client-search projection no longer blocks the main thread for one long task per column. The formatted values of a searchable column (dates, arrays, a `format`) are computed in batches of 512 rows with a yield between them, so the slicer ends the task on time (each batch is one `column:batch`; failures are still reported once per column), reading a column is a task of its own, and the rows matched per chunk scale down with the number of searchable columns. At 100k rows of ten mixed columns under a 4x CPU throttle, the longest task drops from ~157–181 ms to ~32–33 ms (budget ≤ 50 ms).
  
  Fixes #40
- 9b693a6: search: client search is Unicode-normalised (NFC), like the `contains` filter: NFC and NFD spellings of the same text (`Zoë` composed or decomposed, common from macOS, Thai and Vietnamese input) now find each other. Values are normalised once when the matcher is built (only the rare non-NFC values are kept, in a sparse map), never per keystroke.
  
  Fixes #30
- 3082297: Privacy: a `rowKey` path that points into a `sensitive` column (`rowKey: 'contact.email'` with
  column `contact` sensitive), or contains one, now hashes row keys in every diagnostic,
  `toJSON()`, the console text and `explainRow().key`, at every redaction level. Before, only an
  exact match (`rowKey` equal to the sensitive column's key) was recognised, so the raw key (an
  e-mail address) was logged under the development default and under `'keys'` / `'full'`. Values
  of a column inside a sensitive column are now `[sensitive]` as well. Fixes #45.
- 66d10d6: Privacy: under `diagnostics.redact: 'full'`, a table with a `sensitive` column no longer logs
  validator messages of schema issues. Before, only an issue whose path was the sensitive column was
  scrubbed; a root-level refinement or another field's message that quoted the sensitive value
  (`record for 123-45-6789 is inconsistent`) reached `details.issues`, `toJSON()`, the console and
  `explainRow().issues`. With a sensitive column, every schema issue message is now DataKable's own
  text (`invalid value at <path>`) at every level; tables without one keep the validator text under
  `'full'`. Fixes #46.
- 33a0d32: In development, `DK_SSR_ASYNC_DEFERRED` is printed to the console once per process (per JS thread) for a table name and deferred source. A dev server that renders a page several times per request (Next 16 `next dev`: six render passes) creates the table each time and printed the info six or seven times per request; it now prints once (Next dev: once in the render and once in its validation worker thread, on the first request only). Every table still records it in `getDiagnostics()` and passes it to `onDiagnostic`.
  
  Fixes #38
- 55ad4bd: Fix development snapshots being frozen only at the top level: `getState().pagination.pageIndex = 2`
  silently changed the table without a notification. In development the plain objects and arrays of
  every committed slice are now frozen as well, so a nested write throws a `TypeError` at the line
  that made it; class instances (Date, Map, typed arrays) are left alone. Production builds do not
  freeze. Fixes #20.
- 91b163e: Fix no-op `clearSorting()`, `setSorting(<the current sort>)`, `resetColumnFilters()` and
  `setColumnFilter(id, <unchanged>)` calls creating a new slice and notifying subscribers (an extra
  React / Vue render each). An unchanged sort (same ids and directions in the same order) or filter
  set now keeps the slice reference and does not notify, like `setPageIndex` and `clearSearch` already
  did. Fixes #21.
- 6fc764f: Fix a `strict: true` table showing 0 rows with status `'idle'` after `getRowModel()` threw (for
  example `DK_DUPLICATE_ROW_KEY`): the throw left the run before the row model was committed. The
  run now commits the same fallback as any failed run: the last good rows (or none on the first
  run) with status `'error'`. Fixes #43.
- 33a0d32: The tracer (development, or `interceptors: [tracer()]`) now accounts for time-sliced work. A slice run between pipeline runs that takes over the 50 ms budget reports `DK_PERF_HINT` (`a time slice of the "search" step took …`, `details.sliced`), and once the work is done `explain()` shows the step's total over the runs that waited on it and the slices between them (`sorting 20000 2013.0 ms (sliced, 2 runs)`, new `ExplainStep.runs`) instead of the few milliseconds of the run that picked up the result.
  
  `DK_PERF_HINT` also names the column slot most of the time went to when it took at least half of it: `…; 95 % of it in columns[0].format (column "name")` (`details.slot`, `column`, `share`), and the fix names that slot. The tracer times each `column:batch` for this (one timing per batch, never per cell).
  
  Fixes #61
  Fixes #62
- 760c769: Fix the production text of `DK_INVALID_OPTION` for a `fetcher`, `schema` or `searchFn` not
  wrapped with its opt-in import (with `datakable/messages` installed): it read
  "options.fetcher must be withFetcher(fetcher), got fetcher". It now names the entry point and the
  type that was passed: "options.fetcher must be withFetcher(fetcher) from
  '@datakable/core/server', got function" (and `withSchema(schema)` from `@datakable/core/schema`,
  `withSearchFn(searchFn)` from `@datakable/core/search-async`). `diagnostic.details.received` is
  now the type of the value. Fixes #41.

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
