# How to fix

Troubleshooting: what DataKable is telling you and how to fix it. Start from what you see — a
symptom, a `DK_*` code in the console, or a TypeScript error — and each page walks from the likely
causes to a way to confirm which one you have, and a fix you can copy. Every example on these
pages is compiled in CI, and the fixes are tested against the problem they fix.

Two tools answer most "why" questions; both work in the browser console, in tests and on the
server:

- `String(table.explain())` — how many rows each step kept, the page, the `status`, and the open
  diagnostics;
- `String(table.explainRow(key))` — the step that removed one row, with a fix.

`<DataTable />` also writes `data-status` and `data-initial-load` on its root element, and every
problem DataKable detects reaches `onDiagnostic` with a stable `DK_*` code.

## By symptom

| What you see | Page |
|---|---|
| The table is empty although there is data, or shows "No matching rows" | [The table shows no rows](no-rows.md) |
| Clicking a header or setting a filter changes nothing | [Sorting or filtering does nothing](sorting-or-filtering-does-nothing.md) |
| Search returns nothing for a visible value, lags, or makes typing slow | [Search finds nothing, or is slow](search-finds-nothing-or-is-slow.md) |
| The component re-renders forever, the tab freezes, `DK_UPDATE_LOOP` | [Endless re-renders or a frozen page](endless-re-renders.md) |
| Loading never ends; `status` never goes back to `'idle'` | [The loading state never ends](loading-never-ends.md) |
| `DK_FETCH_FAILED`, `DK_FETCH_BAD_RESPONSE`, an error state, retrying | [Fetch errors and retries](fetch-errors-and-retries.md) |
| Loading in the server HTML, React hydration errors, `DK_HYDRATION_MISMATCH` | [SSR and hydration problems](ssr-and-hydration.md) |
| TypeScript rejects a column, a `key`, a filter or `rowKey` | [Reading type errors](reading-type-errors.md) |
| DataKable takes more bundle space than expected | [The bundle is too big](bundle-too-big.md) |
| `ReferenceError: process is not defined` in the browser | [`process is not defined`](process-is-not-defined.md) |
| `DK_INVALID_OPTION` at `options.schema`, `options.fetcher` or `options.searchFn` | [`DK_INVALID_OPTION` for `schema`, `fetcher` or `searchFn`](unwrapped-schema-fetcher-or-searchfn.md) |
| Production diagnostics have an empty `problem` / `fix` | [Diagnostics have no text in production](diagnostics-without-text-in-production.md) |
| Typing, sorting or paging is slow on a large table; memory use | [Memory and speed with many rows](large-data.md) |

## By code

The [diagnostics reference](errors.md) has a section for every `DK_*` code: the problem, the
common causes, the fix and a real example with its console output. The `docs` link each
diagnostic prints opens that section ([how to read a diagnostic](errors.md#reading-a-diagnostic)).

| Group | Codes |
|---|---|
| Keys and data | [`DK_DUPLICATE_ROW_KEY`](errors.md#dk_duplicate_row_key) · [`DK_MISSING_ROW_KEY`](errors.md#dk_missing_row_key) · [`DK_COLUMN_PATH_NOT_FOUND`](errors.md#dk_column_path_not_found) · [`DK_COLUMN_PATH_PARTIAL`](errors.md#dk_column_path_partial) · [`DK_INCONSISTENT_ROW_SHAPE`](errors.md#dk_inconsistent_row_shape) · [`DK_UNRENDERABLE_VALUE`](errors.md#dk_unrenderable_value) · [`DK_DATA_MUTATED`](errors.md#dk_data_mutated) |
| Schema | [`DK_SCHEMA_INVALID_ROW`](errors.md#dk_schema_invalid_row) · [`DK_SCHEMA_CRASHED`](errors.md#dk_schema_crashed) |
| Features | [`DK_FILTER_TYPE_MISMATCH`](errors.md#dk_filter_type_mismatch) · [`DK_SORT_COMPARATOR_INVALID`](errors.md#dk_sort_comparator_invalid) · [`DK_SORT_STRATEGY`](errors.md#dk_sort_strategy) · [`DK_SEARCH_FAILED`](errors.md#dk_search_failed) · [`DK_INVALID_PAGINATION`](errors.md#dk_invalid_pagination) · [`DK_INVALID_VALIDITY`](errors.md#dk_invalid_validity) |
| Async | [`DK_FETCH_FAILED`](errors.md#dk_fetch_failed) · [`DK_FETCH_ABORTED`](errors.md#dk_fetch_aborted) · [`DK_FETCH_BAD_RESPONSE`](errors.md#dk_fetch_bad_response) · [`DK_ASYNC_TIMEOUT`](errors.md#dk_async_timeout) · [`DK_ROW_COUNT_MISSING`](errors.md#dk_row_count_missing) |
| Callbacks and plugins | [`DK_CALLBACK_FAILED`](errors.md#dk_callback_failed) · [`DK_CALLBACK_BAD_RETURN`](errors.md#dk_callback_bad_return) · [`DK_FEATURE_FAILED`](errors.md#dk_feature_failed) · [`DK_FEATURE_BAD_OUTPUT`](errors.md#dk_feature_bad_output) · [`DK_FEATURE_MUTATED_INPUT`](errors.md#dk_feature_mutated_input) · [`DK_INTERCEPTOR_FAILED`](errors.md#dk_interceptor_failed) · [`DK_HOT_INTERCEPTOR`](errors.md#dk_hot_interceptor) · [`DK_OPERATION_CONFLICT`](errors.md#dk_operation_conflict) · [`DK_LISTENER_FAILED`](errors.md#dk_listener_failed) |
| Options and config | [`DK_UNKNOWN_OPTION`](errors.md#dk_unknown_option) · [`DK_INVALID_OPTION`](errors.md#dk_invalid_option) · [`DK_OPTION_NO_EFFECT`](errors.md#dk_option_no_effect) · [`DK_MODE_ORDER`](errors.md#dk_mode_order) · [`DK_FETCHER_WITHOUT_SERVER_MODE`](errors.md#dk_fetcher_without_server_mode) · [`DK_FEATURE_DUPLICATE`](errors.md#dk_feature_duplicate) · [`DK_FEATURE_API_CONFLICT`](errors.md#dk_feature_api_conflict) · [`DK_FEATURE_INCOMPATIBLE`](errors.md#dk_feature_incompatible) · [`DK_CONTROLLED_WITHOUT_HANDLER`](errors.md#dk_controlled_without_handler) · [`DK_CONTROLLED_NOT_FED_BACK`](errors.md#dk_controlled_not_fed_back) · [`DK_UNSTABLE_COLUMNS`](errors.md#dk_unstable_columns) · [`DK_UNSTABLE_OPTION`](errors.md#dk_unstable_option) · [`DK_STATE_UNKNOWN_KEY`](errors.md#dk_state_unknown_key) |
| Lifecycle and SSR | [`DK_TABLE_DESTROYED`](errors.md#dk_table_destroyed) · [`DK_UPDATE_LOOP`](errors.md#dk_update_loop) · [`DK_HYDRATION_MISMATCH`](errors.md#dk_hydration_mismatch) · [`DK_SSR_ASYNC_DEFERRED`](errors.md#dk_ssr_async_deferred) · [`DK_RENDER_FAILED`](errors.md#dk_render_failed) |
| Versions | [`DK_DEPRECATED`](errors.md#dk_deprecated) · [`DK_DUPLICATE_CORE`](errors.md#dk_duplicate_core) · [`DK_VERSION_MISMATCH`](errors.md#dk_version_mismatch) · [`DK_DEP_INCOMPATIBLE`](errors.md#dk_dep_incompatible) |
| Environment and performance | [`DK_ENV_FALLBACK`](errors.md#dk_env_fallback) · [`DK_PERF_HINT`](errors.md#dk_perf_hint) |
| Redaction | [`DK_UNSAFE_REDACTION`](errors.md#dk_unsafe_redaction) |
| Catch-all | [`DK_INTERNAL`](errors.md#dk_internal) · [`DK_UNKNOWN`](errors.md#dk_unknown) |

## Reference pages

- [Diagnostics reference](errors.md) — every `DK_*` code, where diagnostics go, production builds,
  redaction, `explain()` and `explainRow()`.
- [Reading type errors](reading-type-errors.md) — the compile errors you are most likely to meet,
  and the line of each to read.

Both pages moved here from `docs/`; their old addresses, [`docs/errors.md`](../errors.md) (where
the diagnostics' `docs` URLs point) and [`docs/reading-type-errors.md`](../reading-type-errors.md),
keep every anchor and link to the sections here.

## Working recipes to compare with

When a fix is unclear, compare your code with a recipe that does the same thing and works (each
one is compiled and run by a test):

| Problem area | Recipe |
|---|---|
| Server data, loading, errors and retries | [A server-side table](../examples/server-side-table.md) |
| Search through an API (`searchFn`) | [Search through an API](../examples/async-search.md) |
| SSR and hydration | [Server rendering with Next.js](../examples/nextjs-ssr.md) |
| Controlled state that is fed back | [Keep the table's state in the URL](../examples/url-state.md) |
| Schema validation and invalid rows | [Validate rows with a schema](../examples/schema-validation.md) |
| Many rows, speed and memory | [Large data](../examples/large-data.md) |
| Columns, renderers and type errors | [Custom columns](../examples/custom-columns.md) |
| Custom features (`DK_FEATURE_*`) | [A custom feature: row selection](../examples/row-selection-feature.md) |
| Interceptors (`DK_INTERCEPTOR_FAILED`, `DK_HOT_INTERCEPTOR`) | [A logging and analytics interceptor](../examples/logging-interceptor.md) |
| Reporting diagnostics in production | [Report diagnostics to an error tracker](../examples/error-reporting.md) |

## See also

- [How to use](../how-to-use/README.md) — the guides.
- [Examples](../examples/README.md) — working recipes to compare with.
- [Documentation index](../README.md)
