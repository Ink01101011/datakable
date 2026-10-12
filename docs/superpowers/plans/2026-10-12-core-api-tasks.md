# DataKable Core API — Task Breakdown

- **Spec:** [`docs/superpowers/specs/2026-10-12-core-api-design.md`](../specs/2026-10-12-core-api-design.md) (§ references below point there)
- **Rule:** one task = one topic. A task is done when its own tests pass, nothing else in the suite regresses, and any diagnostic codes it introduces are in the catalog.
- **Priority:** all tasks are v1, and priority says what blocks what.
  - **P0** = foundation; everything else waits on it.
  - **P1** = v1 features.
  - **P2** = v1 hardening, quality and release. Still required before the v1 release.
- **Depends on:** tasks that must be finished first. A task with no dependencies can start immediately.
- Each task gets its own detailed implementation plan (writing-plans) when it is picked up.

## Tasks

| ID | P | Task | Spec | Depends on | Done when |
|---|---|---|---|---|---|
| T01 | P0 | Tooling: add `exsorted` / `ex-search` / `kk-debounce` (subpath imports), `fast-check`, `size-limit`; floating-promise lint decision | §12, §11 | — | deps install; lint rule or test-based check chosen and running in CI |
| T02 | P0 | Column types: `Path`, `PathValue`, `FilterFor`, `RenderReq`, `ColumnDef<T,R>`, derived columns, `IsAny` handling | §4.1, §4.2 | — | all prototype type cases pass as `*.test-d.ts` (positive + `@ts-expect-error`) |
| T03 | P0 | `getValue(row, path)` safe walk + default formatter | §4.3 | T02 | unit tests: nulls mid-path, arrays, Date, objects, throwing getters |
| T04 | P0 | Interceptor core: operation registry, `defineInterceptor`, chain compiler, ctx pool, sync/async typing | §3.4 | — | type tests (sync op + Promise = error); compile-once verified; overhead bench recorded |
| T05 | P0 | Diagnostic model + `defineDiagnostic` catalog + `diagnostic:emit` chain (enrich, dedupe/rate-limit, sinks, ring buffer, safe serializer, fingerprint) | §8.1, §8.2, §3.5 | T04 | bigint/cycle-safe `toJSON`; dedupe aggregates; buffer bounded at 100 |
| T06 | P0 | `errorBoundary` + fallback registry + `column:batch` boundary + `DK_CALLBACK_FAILED` / `DK_INTERNAL` / `DK_UNKNOWN` / `DK_INTERCEPTOR_FAILED` | §3.4, §8.6 | T04, T05 | throw in any op → correct code + `where` + registry fallback |
| T07 | P0 | Store: `createTable`, get/set/subscribe, controlled state per slice, listener isolation, update-loop guard, `destroy` | §3.2 | T04, T06 | `DK_LISTENER_FAILED`, `DK_UPDATE_LOOP`, `DK_TABLE_DESTROYED`, `DK_CONTROLLED_WITHOUT_HANDLER` tested |
| T08 | P0 | Feature contract: `defineFeature`, HKT types (`StateOf` / `ApiOf`), stage ordering, duplicate/API-conflict detection | §3.3 | T07 | prototype feature type tests pass; `DK_FEATURE_DUPLICATE` / `DK_FEATURE_API_CONFLICT` thrown |
| T09 | P0 | Pipeline runner: `Uint32Array` index steps, per-step memo, lazy column cache (WeakMap, `Float64Array`), `Row` class for visible rows, `getRowModel` | §6.6, §9.1 | T08, T03 | memo hits verified; 100k-row memory test ≤ 5 MB |
| T10 | P1 | Options catalog `defineOptions` + `optionValidator` (unknown / invalid / no-effect, did-you-mean) | §3.5, §8.3 | T05, T08 | `DK_UNKNOWN_OPTION`, `DK_INVALID_OPTION`, `DK_OPTION_NO_EFFECT` tested |
| T11 | P1 | `rowKey` (path or fn) + duplicate/missing detection with unique-field suggestion | §5.2 | T09 | fallback keys; `fix` names a truly unique field |
| T12 | P1 | Ingest checks: path not found (Levenshtein) / partial, inconsistent shape, zero-config column derivation (first-N union) | §5.3, §4.1 | T09 | did-you-mean correct; derivation skips functions |
| T13 | P1 | Feature `columnFilters` (equals / contains NFC / in / range / custom, array semantics, type mismatch) | §6.1 | T09 | operator matrix tests; `DK_FILTER_TYPE_MISMATCH` |
| T14 | P1 | Feature `sorting`: comparator (type rank, nulls last, `Intl.Collator`), `toggleSort` + multi, `sortFn` / `sortBy` | §6.4 | T09 | stability + nulls-last tests; object column needs sortFn (type test) |
| T15 | P1 | Sort `auto` strategy (tim / counting / radix / native) + overrides + `DK_SORT_STRATEGY` + `DK_SORT_COMPARATOR_INVALID` | §6.4 | T14 | fast-check equals reference stable sort; n ≤ 1k bench shows no significant regression |
| T16 | P1 | Feature `search` (client): ex-search projection `{c0…}`, index map-back, blank query = all, relevance order + tie-break | §6.3 | T09 | identity preserved; relevance order deterministic |
| T17 | P1 | Search typing: `debouncedSignal` / `throttle` strategy, wait, behavior, `minLength`, `commitOn`; state `input` / `query` / `status` | §6.3 | T16 | fake-timer tests per strategy |
| T18 | P1 | `asyncControl` interceptor: AbortController per request, latest-wins, `timeout`, superseded | §3.4, §7.1 | T04, T06 | superseded result never applied even if the callback ignores the signal; `DK_ASYNC_TIMEOUT` |
| T19 | P1 | Async `searchFn` + promise API (`setSearch` / `flushSearch` → `applied` / `superseded` / `error`, never reject) + `DK_SEARCH_FAILED` | §6.3 | T17, T18 | stale-while-error; no unhandled rejections |
| T20 | P1 | Feature `pagination` (page-size anchor, auto-reset, clamp) | §6.5 | T09 | anchor + clamp tests |
| T21 | P1 | Data modes: per-feature `mode`, `DK_MODE_ORDER`, server source `fetcher`, response validation (`DK_FETCH_*`) | §7.1 | T10, T13, T14, T16, T18, T20 | property test over 4 steps × 2 modes; bad response handled |
| T22 | P1 | Standard Schema ingest: infer `T`, validate, `invalidRows` drop / flag / throw, async schema, `DK_SCHEMA_*` | §5.1 | T09, T18 | `Row<T>` union type test for flag; `getInvalidRows` |
| T23 | P1 | Feature `validity` + `row.issues` / `getCellIssues` path matching | §6.2, §5.1 | T13, T22 | issue→column mapping tests; no-op outside flag mode |
| T24 | P1 | Default preset + zero-config `createTable({ data })` | §3.3 | T12, T13, T14, T16, T20, T23 | `createTable({ data })` works end-to-end with no other options |
| T25 | P1 | `tracer` interceptor + `explain()` + `explainRow(key)` | §8.4 | T24 | explainRow pinpoints the removing step for each feature |
| T26 | P1 | Redaction: `safe` / `keys` / `full`, `sensitive` columns, hashed keys, custom `redact`, schema/fetcher message scrubbing | §8.2 | T05 | sentinel test passes under `'safe'` |
| T27 | P2 | Dev checks: `DK_DATA_MUTATED`, `defineSlot` + `DK_CALLBACK_BAD_RETURN`, `DK_FEATURE_BAD_OUTPUT` / `DK_FEATURE_MUTATED_INPUT` | §5.3, §3.5 | T06, T09 | each check fires in dev and is absent from the prod build |
| T28 | P2 | Versioning: `defineDeprecation` + `DK_DEPRECATED`, global registry `DK_DUPLICATE_CORE`, `DK_VERSION_MISMATCH`, `DK_DEP_INCOMPATIBLE`, `DK_FEATURE_INCOMPATIBLE` | §8.5 | T05, T08 | two-core test triggers the duplicate detection |
| T29 | P2 | Env fallbacks (`DK_ENV_FALLBACK`), time-slicing via `scheduler.yield`, `DK_PERF_HINT` | §9.1 | T16, T25 | no task > 50 ms building a 100k projection |
| T30 | P1 | Fault-injection harness: every public method × every callback slot | §11, §8.6 | T06, T24 | every slot throw → code + `where` + usable row model |
| T31 | P1 | React `useDataTable` (uSES, `setOptions` sync, controlled slices, `DK_UNSTABLE_COLUMNS`) | §10 | T24 | renderHook tests; no setState-in-render warnings |
| T32 | P1 | React SSR: `initialState` / `initialData`, `getServerSnapshot`, `DK_HYDRATION_MISMATCH`, `DK_SSR_ASYNC_DEFERRED`, `DK_STATE_UNKNOWN_KEY` | §7.2 | T21, T31 | `renderToString` with `?q=` is pre-filtered; hydrate without re-fetch |
| T33 | P1 | `<DataTable />` zero-config: sort headers + `aria-sort`, search input + status, pagination, empty/loading/error, `data-invalid`, `components` overrides | §10 | T23, T31 | testing-library interaction tests |
| T34 | P2 | React error boundary + per-cell fallback (`DK_RENDER_FAILED`) | §10, §8.6 | T06, T33 | a throwing child shows the error state; the table survives |
| T35 | P2 | Optional `datakable/styles.css` | §10 | T33 | importing it styles the table; not importing it adds no CSS |
| T36 | P2 | Packaging: per-feature entries, prod stripping (`NODE_ENV`), `datakable/messages`, type-leak consumer check | §12, §8.2 | T24 | publint + attw pass; consumer with `skipLibCheck: false` compiles |
| T37 | P2 | Budgets in CI: size-limit, batch-overhead bench, memory test, 4x-throttled interaction test | §9.3 | T15, T29, T36 | all §9.3 budgets enforced; exceeding one is raised with the user |
| T38 | P2 | `docs/errors.md` (one section per code) + catalog CI test (entry + anchor + fault test per code) | §8.3 | T10, T11, T12, T15, T19, T21, T22, T26, T27, T28, T29, T30, T32, T34 | CI fails on any code missing docs or a test |
| T39 | P2 | Update `apps/docs` playground to the real API | — | T33 | playground uses `<DataTable />` and `useDataTable` |
| T40 | P2 | READMEs + first changeset | §12 | T36 | READMEs describe the real API; changeset added |

## Order (dependency waves)

Tasks within a wave do not depend on each other and can run in parallel.

| Wave | Tasks |
|---|---|
| 0 | T01, T02, T04 |
| 1 | T03, T05 |
| 2 | T06, T26 |
| 3 | T07, T18 |
| 4 | T08 |
| 5 | T09, T10, T28 |
| 6 | T11, T12, T13, T14, T16, T20, T22, T27 |
| 7 | T15, T17, T21, T23 |
| 8 | T19, T24 |
| 9 | T25, T30, T31, T36 |
| 10 | T29, T32, T33, T40 |
| 11 | T34, T35, T37, T39 |
| 12 | T38 |

**Critical path:** T04 → T05 → T06 → T07 → T08 → T09 → T13 → T23 → T24 → T31 → T33 → T34 → T38

## Follow-ups outside this breakdown

- **Spec 2 — Selection** (row/cell, Ctrl/Cmd+click, Shift+click range): brainstorm after T24 lands, because it builds on the feature contract and the interceptors.
- **kk-debounce#28** (`autoAbort` no-op): fix in the kk-debounce repo. DataKable does not depend on it (T18 owns abort).
