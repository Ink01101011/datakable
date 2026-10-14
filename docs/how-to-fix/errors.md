# DataKable diagnostics reference

Every problem DataKable detects is reported as a **diagnostic** with a stable code (`DK_*`). Codes
are public API: a code is never reused or given another meaning, and a retired code stays on this
page with the version that removed it. Every diagnostic links to its section: the `docs` URL is
`docs/errors.md#<code in lower case>`, the page's [old address](../errors.md), which keeps every
anchor and forwards here. To start from what you see rather than from a code, use
[troubleshooting by symptom](README.md).

Each section below has the same four parts: **Problem** (what the code means), **Common causes**,
**Fix**, and an **Example**. Every example is real: the TypeScript blocks are files of
[`packages/datakable/src/errors-examples/`](../../packages/datakable/src/errors-examples/), which CI
compiles and runs, and the output block under each one must be exactly what DataKable printed
(`packages/datakable/src/errors-doc.test.tsx`). A few codes cannot be produced by a snippet (a
second copy of core, a production build, a bug in DataKable): their output is built from the
details their fault-injection test asserts, through the real catalog entry. In the outputs,
`<version>` stands for the installed version, and times (`0.58 ms`) vary between runs.

The examples import from `@datakable/core` and `@datakable/react`; `datakable` re-exports both
(its `createTable`, `useDataTable` and `<DataTable />` install the default features).

## Reading a diagnostic

In development, the console prints one collapsed group per diagnostic:

```text
✖ [DataKable UsersTable] DK_DUPLICATE_ROW_KEY: rowKey "id" is not unique: rows #1, #2 share id = 42
  where   row #2 (key 42)
  impact  1 row renders with fallback keys (42#1) — updates may hit the wrong row
  fix     1. rowKey: 'uuid' (unique in all 3 rows)
          2. rowKey: 'name' (unique in all 3 rows)
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_duplicate_row_key
  context trigger=init run=1 phase=client
```

- **header**: level (`✖` error, `⚠` warn, `ℹ` info), the table (`options.name`, else `table#n`),
  the code and the **problem**, computed from your data.
- **where**: the exact place in your code or data:
  - `columns[1] (id "age")`: a column, by position in `options.columns` and id;
  - `options.<path>`: an option. A feature's function option is written as an option path:
    `options.searchFn` is `search({ searchFn })`, `options.sorting.algorithm` is
    `sorting({ algorithm })`;
  - `feature "sorting"`: a feature (or a plugin's `defineFeature`);
  - `row #2 (key 42)`: a row, by its index in `options.data` (the key is hashed under `'safe'`);
  - `interceptor "timing" on column:batch`: an interceptor on an operation;
  - `operation table.setPageSize`, `operation render:cell at columns[1].cell`: a public method, or
    an internal operation at a slot.
- **impact**: what the table did instead (the fallback). DataKable never fails silently, and a data
  or runtime problem never throws (except under `strict: true` or `invalidRows: 'throw'`).
- **fix**: concrete fixes, best first, computed from your data (field names, counts, types).
- **context**: what triggered it (`init`, `data-change`, `setOptions`, `fetch`, `hydrate`,
  `api:<method>`), the pipeline run (the same `run` as `table.explain()`), and the phase (`ssr`,
  `hydrate`, `client`).

## Where diagnostics go

- `onDiagnostic: (d) => …` (an option): every diagnostic, e.g. for Sentry. `d.toJSON()` is a safe
  serialisation (bigint, cycles, errors); the original error, when there is one, is `d.context.cause`
  and reaches `onDiagnostic` only.
- `table.getDiagnostics()`: the last 100.
- The console: development prints every diagnostic as above; production prints **error** level only,
  on one line (`[DataKable table#1] DK_FETCH_FAILED at options.fetcher — <docs url>`). The console is
  rate-limited (20 per second); what it holds back is still in `getDiagnostics()` and `onDiagnostic`.
- A diagnostic is reported once per code and `where` per `data` reference (`context.occurrences`
  counts repeats); new data reports it again.
- `strict: true` throws error-level diagnostics as `DatakableError` (useful in tests).
- **Config errors** are thrown at creation as `DatakableConfigError` (same fields: code, problem,
  where, fix, docs): [`DK_INVALID_OPTION`](#dk_invalid_option), [`DK_MODE_ORDER`](#dk_mode_order),
  [`DK_FETCHER_WITHOUT_SERVER_MODE`](#dk_fetcher_without_server_mode),
  [`DK_FEATURE_DUPLICATE`](#dk_feature_duplicate),
  [`DK_FEATURE_API_CONFLICT`](#dk_feature_api_conflict),
  [`DK_FEATURE_INCOMPATIBLE`](#dk_feature_incompatible),
  [`DK_OPERATION_CONFLICT`](#dk_operation_conflict). Given to `setOptions()` instead, the call is
  rejected and the previous options are kept.
- **Status:** a diagnostic that affects the row model (a failed step, ingest, fetch or search) sets
  `getRowModel().status` to `'error'` and keeps the last good rows. A cell-level problem handled
  inside a step (a throwing `format` / `accessor` / filter `fn`, `DK_FILTER_TYPE_MISMATCH`) is
  reported but leaves the status as it was.

## Production builds

- The text builders are development-only (`process.env.NODE_ENV !== 'production'`): a production
  diagnostic keeps its `code`, `level`, `where` and `context`, and its `docs` URL carries
  `?v=<version>&where=<where>`; `problem`, `impact` and `fix` are empty. Add
  `import 'datakable/messages'` (or `@datakable/core/messages`) once to get the full text in
  production.
- **Development only** (absent from production bundles, never emitted there): the dev checks
  [`DK_DATA_MUTATED`](#dk_data_mutated),
  [`DK_CONTROLLED_NOT_FED_BACK`](#dk_controlled_not_fed_back),
  [`DK_CALLBACK_BAD_RETURN`](#dk_callback_bad_return),
  [`DK_FEATURE_BAD_OUTPUT`](#dk_feature_bad_output),
  [`DK_FEATURE_MUTATED_INPUT`](#dk_feature_mutated_input),
  [`DK_SORT_COMPARATOR_INVALID`](#dk_sort_comparator_invalid),
  [`DK_HOT_INTERCEPTOR`](#dk_hot_interceptor), and React's
  [`DK_UNSTABLE_COLUMNS`](#dk_unstable_columns) / [`DK_UNSTABLE_OPTION`](#dk_unstable_option).
  Also (since 2026-10-13, to keep the production bundle small, §9.3) the option validator —
  [`DK_UNKNOWN_OPTION`](#dk_unknown_option), [`DK_INVALID_OPTION`](#dk_invalid_option) and its
  [`DK_OPTION_NO_EFFECT`](#dk_option_no_effect) reports —, [`DK_MODE_ORDER`](#dk_mode_order), the
  version checks [`DK_FEATURE_INCOMPATIBLE`](#dk_feature_incompatible),
  [`DK_DUPLICATE_CORE`](#dk_duplicate_core) and [`DK_VERSION_MISMATCH`](#dk_version_mismatch),
  and the data checks [`DK_COLUMN_PATH_NOT_FOUND`](#dk_column_path_not_found),
  [`DK_COLUMN_PATH_PARTIAL`](#dk_column_path_partial) and
  [`DK_INCONSISTENT_ROW_SHAPE`](#dk_inconsistent_row_shape). A production `setOptions` still keeps
  the read-once options, and a `schema` / `fetcher` / `searchFn` not wrapped with `withSchema()` /
  `withFetcher()` / `withSearchFn()` still throws `DK_INVALID_OPTION` (a small production guard,
  never ignored silently).
  The tracer, which reports [`DK_PERF_HINT`](#dk_perf_hint), runs in development; in production
  only with `interceptors: [tracer()]`.
- **Production only:** [`DK_UNSAFE_REDACTION`](#dk_unsafe_redaction).

## Redaction

`diagnostics: { redact }` decides what user data diagnostics carry (in `details`, `where`, the
text, `toJSON()` and every sink):

| Level | Includes | Default for |
|---|---|---|
| `'safe'` | paths, indices, counts, value *types* (`string(12)`), row keys as short hashes (`h:1a2b3c4d`) | production |
| `'keys'` | `'safe'` + raw row-key values | development |
| `'full'` | `'keys'` + cell values | — (warns in production: [`DK_UNSAFE_REDACTION`](#dk_unsafe_redaction)) |

- A column with `sensitive: true` is never logged, at any level; a `rowKey` column that is
  sensitive is hashed at every level. A function `redact: (path, value) => string | undefined` adds
  your own rules.
- **Row-key hashes are pseudonymisation, not anonymisation.** They are unsalted 32-bit FNV-1a
  hashes: anyone who knows a key can hash it and find its diagnostics, and short or enumerable keys
  (sequential ids, emails from a known list) can be recovered by hashing candidates. Treat hashed
  diagnostics as personal data wherever the keys are.
- Thrown errors are logged as `error.name` (and `code`) only: messages of validators, fetchers and
  engines embed values. The error itself is `context.cause`, passed to `onDiagnostic` only (never
  to the console or `toJSON()`). Schema issue messages are replaced by the issue path and
  DataKable's own text under `'safe'` / `'keys'`.
- When `onDiagnostic` or a `diagnostic:emit` interceptor itself throws, DataKable prints one
  `console.error` and goes quiet; a production build prints only that error's name there too.

## Debugging tools: `explain()` and `explainRow()`

`table.explain()` shows where the rows went in the last run; `table.explainRow(key)` replays one
row through every step and names the step that removed it (with a fix when it can compute one).
Both go through the redaction policy. For four products, a `range` filter `{ min: 100 }` and the
search `'chair'` (`features: defaultFeatures`):

```text
run 2 0.7 ms · trigger api:setSearch · 4 rows → columnFilters 3 cached → validity 3 cached → search 2 0.7 ms → sorting 2 0.0 ms → page 1/1 (2) · status idle · 0 open diagnostics
```

`String(table.explainRow('SKU-050'))` (`visible: false`, `removedBy: 'search'`):

```text
row SKU-050 · data index 3 · run 2
  – schema        no schema
  ✓ columnFilters position 3 of 3
  ✓ validity      position 3 of 3
  ✗ search        query (5 chars) did not match (threshold 0.3)   ← removed here
  · sorting       not reached
  · pagination    not reached
  fix             search({ threshold: 0.2 }) or check the query spelling
```

The timings come from the `tracer` interceptor, which `createTable` installs in development. In
production it is off (no cost); `explain()` then recomputes the counts on demand, without timings.
To trace a production table, install it: `createTable({ interceptors: [tracer()] })` (there is no
`trace` option).

## Index

| Code | Level | Group |
|---|---|---|
| [`DK_DUPLICATE_ROW_KEY`](#dk_duplicate_row_key) | error | Keys and data |
| [`DK_MISSING_ROW_KEY`](#dk_missing_row_key) | error | Keys and data |
| [`DK_COLUMN_PATH_NOT_FOUND`](#dk_column_path_not_found) | warn | Keys and data |
| [`DK_COLUMN_PATH_PARTIAL`](#dk_column_path_partial) | info | Keys and data |
| [`DK_INCONSISTENT_ROW_SHAPE`](#dk_inconsistent_row_shape) | info | Keys and data |
| [`DK_UNRENDERABLE_VALUE`](#dk_unrenderable_value) | warn | Keys and data |
| [`DK_DATA_MUTATED`](#dk_data_mutated) | warn | Keys and data |
| [`DK_SCHEMA_INVALID_ROW`](#dk_schema_invalid_row) | error | Schema |
| [`DK_SCHEMA_CRASHED`](#dk_schema_crashed) | error | Schema |
| [`DK_FILTER_TYPE_MISMATCH`](#dk_filter_type_mismatch) | warn | Features |
| [`DK_SORT_COMPARATOR_INVALID`](#dk_sort_comparator_invalid) | warn | Features |
| [`DK_SORT_STRATEGY`](#dk_sort_strategy) | info | Features |
| [`DK_SEARCH_FAILED`](#dk_search_failed) | error | Features |
| [`DK_INVALID_PAGINATION`](#dk_invalid_pagination) | warn | Features |
| [`DK_INVALID_VALIDITY`](#dk_invalid_validity) | warn | Features |
| [`DK_FETCH_FAILED`](#dk_fetch_failed) | error | Async |
| [`DK_FETCH_ABORTED`](#dk_fetch_aborted) | info | Async |
| [`DK_FETCH_BAD_RESPONSE`](#dk_fetch_bad_response) | error | Async |
| [`DK_ASYNC_TIMEOUT`](#dk_async_timeout) | error | Async |
| [`DK_ROW_COUNT_MISSING`](#dk_row_count_missing) | warn | Async |
| [`DK_CALLBACK_FAILED`](#dk_callback_failed) | error | Callbacks and plugins |
| [`DK_CALLBACK_BAD_RETURN`](#dk_callback_bad_return) | warn | Callbacks and plugins |
| [`DK_FEATURE_FAILED`](#dk_feature_failed) | error | Callbacks and plugins |
| [`DK_FEATURE_BAD_OUTPUT`](#dk_feature_bad_output) | error | Callbacks and plugins |
| [`DK_FEATURE_MUTATED_INPUT`](#dk_feature_mutated_input) | warn | Callbacks and plugins |
| [`DK_INTERCEPTOR_FAILED`](#dk_interceptor_failed) | error | Callbacks and plugins |
| [`DK_HOT_INTERCEPTOR`](#dk_hot_interceptor) | warn | Callbacks and plugins |
| [`DK_OPERATION_CONFLICT`](#dk_operation_conflict) | error | Callbacks and plugins |
| [`DK_LISTENER_FAILED`](#dk_listener_failed) | error | Callbacks and plugins |
| [`DK_UNKNOWN_OPTION`](#dk_unknown_option) | warn | Options and config |
| [`DK_INVALID_OPTION`](#dk_invalid_option) | error | Options and config |
| [`DK_OPTION_NO_EFFECT`](#dk_option_no_effect) | warn | Options and config |
| [`DK_MODE_ORDER`](#dk_mode_order) | error | Options and config |
| [`DK_FETCHER_WITHOUT_SERVER_MODE`](#dk_fetcher_without_server_mode) | error | Options and config |
| [`DK_FEATURE_DUPLICATE`](#dk_feature_duplicate) | error | Options and config |
| [`DK_FEATURE_API_CONFLICT`](#dk_feature_api_conflict) | error | Options and config |
| [`DK_FEATURE_INCOMPATIBLE`](#dk_feature_incompatible) | error | Options and config |
| [`DK_CONTROLLED_WITHOUT_HANDLER`](#dk_controlled_without_handler) | warn | Options and config |
| [`DK_CONTROLLED_NOT_FED_BACK`](#dk_controlled_not_fed_back) | warn | Options and config |
| [`DK_UNSTABLE_COLUMNS`](#dk_unstable_columns) | warn | Options and config |
| [`DK_UNSTABLE_OPTION`](#dk_unstable_option) | warn | Options and config |
| [`DK_STATE_UNKNOWN_KEY`](#dk_state_unknown_key) | warn | Options and config |
| [`DK_TABLE_DESTROYED`](#dk_table_destroyed) | warn | Lifecycle and SSR |
| [`DK_UPDATE_LOOP`](#dk_update_loop) | error | Lifecycle and SSR |
| [`DK_HYDRATION_MISMATCH`](#dk_hydration_mismatch) | warn | Lifecycle and SSR |
| [`DK_SSR_ASYNC_DEFERRED`](#dk_ssr_async_deferred) | info | Lifecycle and SSR |
| [`DK_RENDER_FAILED`](#dk_render_failed) | error | Lifecycle and SSR |
| [`DK_DEPRECATED`](#dk_deprecated) | warn | Versions |
| [`DK_DUPLICATE_CORE`](#dk_duplicate_core) | error | Versions |
| [`DK_DUPLICATE_CORE_SAME_VERSION`](#dk_duplicate_core_same_version) | info | Versions |
| [`DK_VERSION_MISMATCH`](#dk_version_mismatch) | warn | Versions |
| [`DK_DEP_INCOMPATIBLE`](#dk_dep_incompatible) | warn | Versions |
| [`DK_ENV_FALLBACK`](#dk_env_fallback) | info | Environment and performance |
| [`DK_PERF_HINT`](#dk_perf_hint) | info | Environment and performance |
| [`DK_UNSAFE_REDACTION`](#dk_unsafe_redaction) | warn | Redaction |
| [`DK_INTERNAL`](#dk_internal) | error | Catch-all |
| [`DK_UNKNOWN`](#dk_unknown) | error | Catch-all |

## For plugin authors

- Define a code next to the code that emits it, and declare its details for type checking:
  `declare module '@datakable/core' { interface DiagnosticCatalog { DK_MY_CODE: { … } } }`, then
  `defineDiagnostic({ code, level, where, problem, impact, fix })`. `where` and a non-empty `fix`
  are required; compute both from the details.
- Emit it with `ctx.emit(code, details)` inside an interceptor or a feature, or with
  `emitTableDiagnostic(table, code, details)` from code outside the table (a binding, a component).
- Call `keepDiagnostics(definitions)` at the top level of the emitting module, so bundlers keep the
  definitions (`pnpm check:catalog` checks the built packages and consumer bundles).
- Deprecate your own API with `defineDeprecation` + `warnDeprecated` ([`DK_DEPRECATED`](#dk_deprecated)).
- A code added to DataKable itself needs a section on this page (with a runnable example), an entry
  in [`fault-injection/injected-by.ts`](../../packages/core/src/fault-injection/injected-by.ts) naming
  its fault-injection test, and a row in the spec's catalog table; CI fails otherwise.

## Keys and data

### DK_DUPLICATE_ROW_KEY

`error` · fault test: [row-key.test.ts](../../packages/core/src/ingest/row-key.test.ts)

**Problem.** Two or more rows have the same `rowKey` value. Row keys identify rows across updates (React keys, `explainRow(key)`, state that refers to rows), so each must be unique. The later rows get fallback keys `key#1`, `key#2`, … (the first keeps its key), in data order.

**Common causes.**

- `rowKey` names a field that is not unique (`name`, `email` with duplicates, a foreign key).
- Duplicate rows in the source data (a join or a paginated API that returns a row twice).
- A `rowKey` function that combines too few fields.

**Fix.**

- Use a field that is unique in every row: the fix lists the fields DataKable verified unique across **all** rows (a scan of the data, not a sample).
- Combine fields: `` rowKey: (row) => `${row.id}-${row.branch}` `` (suggested when a field makes a unique pair with the current key).
- Remove the duplicates at the source.

**Example.**

```ts
import { createTable } from '@datakable/core'

const users = [
  { id: 7, uuid: 'a1', name: 'Ada' },
  { id: 42, uuid: 'b2', name: 'Grace' },
  { id: 42, uuid: 'c3', name: 'Linus' },
]

const table = createTable({ data: users, rowKey: 'id' })
table.getRowModel()
```

prints (development console):

```text
✖ [DataKable table#1] DK_DUPLICATE_ROW_KEY: rowKey "id" is not unique: rows #1, #2 share id = 42
  where   row #2 (key 42)
  impact  1 row renders with fallback keys (42#1) — updates may hit the wrong row
  fix     1. rowKey: 'uuid' (unique in all 3 rows)
          2. rowKey: 'name' (unique in all 3 rows)
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_duplicate_row_key
  context trigger=init run=1 phase=client
```

### DK_MISSING_ROW_KEY

`error` · fault test: [row-key.test.ts](../../packages/core/src/ingest/row-key.test.ts)

**Problem.** Some rows have no usable key at the `rowKey` path (`undefined`, `null`, an object, `NaN`), or the `rowKey` function returned none. Those rows get the fallback key `#<index>`, which changes when rows are added or removed.

**Common causes.**

- Rows created on the client that have no id yet (drafts, optimistic inserts).
- `rowKey` points at an optional or misspelled field.
- A `rowKey` function that returns `undefined` for some rows.

**Fix.**

- Give every row a string or a number at the `rowKey` path.
- Or use a field the fix lists as unique across all rows, or a function combining fields.
- For drafts, give them a temporary client id (`crypto.randomUUID()`).

**Example.**

```ts
import { createTable } from '@datakable/core'

type User = { id?: number; email: string; name: string }
const users: User[] = [
  { id: 1, email: 'ada@example.com', name: 'Ada' },
  { email: 'grace@example.com', name: 'Grace' }, // no id yet (a draft row)
  { id: 3, email: 'linus@example.com', name: 'Linus' },
]

const table = createTable({ data: users, rowKey: 'id', columns: [{ key: 'name' }] })
table.getRowModel()
```

prints (development console):

```text
✖ [DataKable table#1] DK_MISSING_ROW_KEY: 1 row has no usable key at "id" (rows #1; the first is undefined)
  where   row #1
  impact  those rows use the fallback key '#<index>', which changes when rows are added or removed
  fix     1. rowKey: 'email' (unique in all 3 rows)
          2. rowKey: 'name' (unique in all 3 rows)
          3. give every row a string or a number at "id"
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_missing_row_key
  context trigger=init run=1 phase=client
```

### DK_COLUMN_PATH_NOT_FOUND

`warn` · development only · fault test: [data-checks.test.ts](../../packages/core/src/ingest/data-checks.test.ts)

**Problem.** A column's `key` path exists in none of the first 50 rows (`INGEST_SAMPLE`). The column reads `undefined` in every row and renders `''`. The fix suggests the closest existing paths (did-you-mean).

**Common causes.**

- A typo in `key`, or a path written for another API shape (`user.name` vs `userName`).
- Untyped data (`any`, `Record<string, unknown>`) that hides the typo from TypeScript.
- A field that only appears in later rows: only the first 50 rows are checked.

**Fix.**

- Use the suggested key, or compute the value with `{ id, accessor: (row) => … }`.
- If the field really appears only later, ignore the warning, or set a `format` that shows a placeholder.

**Example.**

```ts
import { createTable } from '@datakable/core'

const users = [
  { id: 1, name: 'Ada', age: 36 },
  { id: 2, name: 'Grace', age: 45 },
]

// A typo, or a column written for another API shape (untyped data hides it from TypeScript).
// @ts-expect-error 'agee' is not a path of the row: TypeScript catches the typo too
createTable({ data: users, columns: [{ key: 'name' }, { key: 'agee' }] })
```

prints (development console):

```text
⚠ [DataKable table#1] DK_COLUMN_PATH_NOT_FOUND: columns[1] key "agee" does not exist in any of the first 2 rows (did you mean "age"?)
  where   columns[1] (id "agee")
  impact  the column reads undefined in every row and renders ''
  fix     1. columns[1]: { key: 'age' }
          2. or compute the value: columns[1]: { id: 'agee', accessor: (row) => … }
          3. or, if the field only appears in later rows, ignore this (only the first rows are checked)
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_column_path_not_found
  context trigger=data-change run=0 phase=client
```

### DK_COLUMN_PATH_PARTIAL

`info` · development only · fault test: [data-checks.test.ts](../../packages/core/src/ingest/data-checks.test.ts)

**Problem.** A column's `key` path is missing in some of the first 50 rows (`INGEST_SAMPLE`). Those cells read `undefined` and the default formatter renders `''`. Reported with the count and the first row indices.

**Common causes.**

- Optional fields in the data (`email?`, sparse API responses).
- Rows from two sources with different shapes.

**Fix.**

- Show a placeholder: `format: (v) => v ?? '—'`.
- Or fill the field in every row before passing the data, if it is required.

**Example.**

```ts
import { createTable } from '@datakable/core'

type User = { id: number; name: string; email?: string }
const users: User[] = [
  { id: 1, name: 'Ada', email: 'ada@example.com' },
  { id: 2, name: 'Grace' },
  { id: 3, name: 'Linus', email: 'linus@example.com' },
  { id: 4, name: 'Margaret' },
]

createTable({ data: users, columns: [{ key: 'name' }, { key: 'email' }] })
```

prints (development console):

```text
ℹ [DataKable table#1] DK_COLUMN_PATH_PARTIAL: columns[1] key "email" is missing in 2 of the first 4 rows (#1, #3)
  where   columns[1] (id "email")
  impact  those cells read undefined and render '' with the default formatter
  fix     1. show a placeholder: columns[1].format: (v) => v ?? '—'
          2. or fill the field in every row before passing data, if it is required
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_column_path_partial
  context trigger=data-change run=0 phase=client
```

### DK_INCONSISTENT_ROW_SHAPE

`info` · development only · fault test: [data-checks.test.ts](../../packages/core/src/ingest/data-checks.test.ts)

**Problem.** Zero-config columns (no `columns` option) are derived from the rows' keys, and the first 50 rows (`INGEST_SAMPLE`) do not all have the same keys. The columns are the union of the keys; missing cells render `''`.

**Common causes.**

- Optional fields in the data, or rows from different sources.
- A field that only some API versions return.

**Fix.**

- Pass `columns` explicitly (you choose the columns and their order).
- Or normalise the rows so every row has the same keys.

**Example.**

```ts
import { createTable } from '@datakable/core'

// Zero-config columns (no `columns` option) from rows that do not all have the same keys.
const rows: Record<string, unknown>[] = [
  { id: 1, name: 'Ada', team: 'core' },
  { id: 2, name: 'Grace' },
  { id: 3, name: 'Linus', team: 'kernel', remote: true },
]

createTable({ data: rows })
```

prints (development console):

```text
ℹ [DataKable table#1] DK_INCONSISTENT_ROW_SHAPE: rows have differing keys in the first 3 rows: "team" missing in 1, "remote" missing in 2 (rows #0, #1)
  where   options.columns
  impact  zero-config columns are the union of the keys; missing cells render ''
  fix     1. pass columns explicitly: columns: [{ key: 'team' }, { key: 'remote' }, …]
          2. or normalise the rows so every row has the same keys
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_inconsistent_row_shape
  context trigger=data-change run=0 phase=client
```

### DK_UNRENDERABLE_VALUE

`warn` · fault test: [pipeline.test.ts](../../packages/core/src/pipeline/pipeline.test.ts)

**Problem.** Cells of a column hold objects, arrays or functions, which the default formatter cannot turn into text. Those cells render `''` and match no search. Reported once per column and data: when the column is first searched (`count` over every row), or when `<DataTable />` renders such a cell (`count` over the rendered rows).

**Common causes.**

- A column `key` that points at an object (`address`) instead of a field (`address.city`).
- Untyped data: with a typed row, TypeScript requires a `format` or `cell` on an object column.

**Fix.**

- Give the column a `format: (value) => string`.
- Or render it with `cell`, or point the key at a primitive field (`address.city`).

**Example.**

```ts
import { createTable, search } from '@datakable/core'

// Untyped JSON: with a typed row, TypeScript asks for a format on an object column.
const users: Record<string, unknown>[] = [
  { id: 1, name: 'Ada', address: { city: 'London' } },
  { id: 2, name: 'Grace', address: { city: 'New York' } },
]

// `address` is an object: the default formatter cannot turn it into text.
const table = createTable({
  data: users,
  columns: [{ key: 'name' }, { key: 'address' }],
  features: [search()],
})
await table.setSearch('london') // matches nothing: the address cells are ''
```

prints (development console):

```text
⚠ [DataKable table#1] DK_UNRENDERABLE_VALUE: column "address" has 2 values of type object (rows #0, #1) that the default formatter cannot render
  where   columns[1] (id "address")
  impact  those cells render '' (and match no search)
  fix     1. give columns[1] a format: (value) => string, e.g. format: (v) => v.name
          2. or render it yourself with cell: ({ value }) => … on columns[1]
          3. or point the column at a primitive field: key: 'address.<field>'
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_unrenderable_value
  context trigger=api:setSearch run=1 phase=client
```

### DK_DATA_MUTATED

`warn` · development only · fault test: [data-mutation.test.ts](../../packages/core/src/table/data-mutation.test.ts)

**Problem.** `options.data` was passed again as the same array, but its contents changed since it was ingested. DataKable re-reads data only when the array reference changes, so the table keeps showing the previous rows. A sample of rows is compared (bounded cost).

**Common causes.**

- `data.push(row)` / `data[i] = row` / `row.field = x`, then `setOptions({ data })` with the same array.
- React state updated in place (`rows.push(…); setRows(rows)`).

**Fix.**

- Pass a new array: `setOptions({ data: [...data, row] })`; in React update state immutably (`setRows((rows) => [...rows, row])`).
- Replace a changed row instead of editing it: `rows.map((r) => (r.id === id ? { ...r, ...patch } : r))`.

**Example.**

```ts
import { createTable } from '@datakable/core'

const users = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Grace' },
]
const table = createTable({ data: users, rowKey: 'id' })

users.push({ id: 3, name: 'Linus' }) // mutates the array the table already has
table.setOptions({ data: users }) // same reference: the table still shows 2 rows
```

prints (development console):

```text
⚠ [DataKable table#1] DK_DATA_MUTATED: options.data is the same array as before, but its contents changed (length 2 → 3)
  where   options.data
  impact  the table still shows the previous contents: data is re-read only when the array reference changes
  fix     1. pass a new array instead of mutating it: setOptions({ data: [...data, row] }); in React, update state immutably: setRows((rows) => [...rows, row])
          2. to change one row, replace it: rows.map((r) => (r.id === id ? { ...r, ...patch } : r))
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_data_mutated
  context trigger=setOptions run=0 phase=client
```

## Schema

### DK_SCHEMA_INVALID_ROW

`error` · fault test: [schema.test.ts](../../packages/core/src/ingest/schema.test.ts)

**Problem.** Rows failed `options.schema` (any Standard Schema v1: zod, valibot, arktype, …). What happens to them depends on `invalidRows`: `'drop'` (default) removes them, `'flag'` keeps them with `row.valid === false` and `row.issues`, `'throw'` throws `DatakableSchemaError` and keeps the previous data. `where` is `options.schema`; the fix maps each issue path to the column that shows it (the same matching as `row.getCellIssues`).

**Common causes.**

- The API returns another type than the schema expects (a numeric string, `null`).
- The schema is stricter than the data (a required field the source omits).
- A schema written for another version of the API.

**Fix.**

- Fix the data at the source, or relax the schema at the reported path (e.g. `z.coerce.number()`).
- Keep and show the invalid rows with `invalidRows: 'flag'` (and `validity()` to filter them).
- Inspect them with `table.getInvalidRows()`: index, raw value and issues per row.

**Example.**

```ts
import { createTable, type StandardSchemaV1 } from '@datakable/core'
import { withSchema } from '@datakable/core/schema'

type User = { id: number; name: string; age: number }
// Any Standard Schema v1 (zod, valibot, arktype, …); a hand-written one here.
const UserSchema: StandardSchemaV1<unknown, User> = {
  '~standard': {
    version: 1,
    vendor: 'example',
    validate: (v) =>
      typeof (v as User).age === 'number'
        ? { value: v as User }
        : { issues: [{ message: 'Expected number', path: ['age'] }] },
  },
}

const json: unknown[] = [
  { id: 1, name: 'Ada', age: 36 },
  { id: 2, name: 'Grace', age: '45' }, // a string from the API
  { id: 3, name: 'Linus', age: 54 },
]

const table = createTable({
  data: json,
  schema: withSchema(UserSchema),
  columns: [{ key: 'name' }, { key: 'age' }],
})
table.getRowModel() // 2 rows: row #1 was dropped (invalidRows: 'drop', the default)
```

prints (development console):

```text
✖ [DataKable table#1] DK_SCHEMA_INVALID_ROW: 1 of 3 rows failed schema validation (rows #1)
  where   options.schema
  impact  that row was removed from the table (getInvalidRows() lists them)
  fix     1. 1 row fail at "age", column "age" (columns[1]): fix the data source there, or relax the schema at "age"
          2. use invalidRows: 'flag' to keep and show the invalid rows instead of dropping them
          3. inspect them with table.getInvalidRows() (index, raw value and issues per row)
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_schema_invalid_row
  context trigger=data-change run=0 phase=client
```

### DK_SCHEMA_CRASHED

`error` · fault test: [slots.test.ts](../../packages/core/src/fault-injection/slots.test.ts)

**Problem.** The schema threw (or its promise rejected) instead of returning issues. Each such row gets a synthetic issue and is handled per `invalidRows`. `where` is `options.schema`; the original error is `context.cause`.

**Common causes.**

- A custom refinement or transform that throws on unexpected input (`.refine((v) => v.email.includes('@'))` when `email` is missing).
- A schema that calls a service (async validation) that fails.

**Fix.**

- Make custom checks return an issue instead of throwing (`ctx.addIssue`, a `refine` predicate that guards `undefined`).
- Find the throwing refinement through `context.cause` in `onDiagnostic`.

**Example.**

```ts
import { createTable, type StandardSchemaV1 } from '@datakable/core'
import { withSchema } from '@datakable/core/schema'

type User = { id: number; email: string }
// A custom check that throws instead of returning an issue.
const UserSchema: StandardSchemaV1<unknown, User> = {
  '~standard': {
    version: 1,
    vendor: 'example',
    validate: (v) => {
      const email = (v as { email?: string }).email
      if (!email?.includes('@')) throw new TypeError('bad email')
      return { value: v as User }
    },
  },
}

const table = createTable({
  data: [{ id: 1, email: 'ada@example.com' }, { id: 2 }],
  schema: withSchema(UserSchema),
})
table.getRowModel()
```

prints (development console):

```text
✖ [DataKable table#1] DK_SCHEMA_CRASHED: the schema threw TypeError instead of returning issues for 1 row (rows #1)
  where   options.schema
  impact  each such row got a synthetic issue and was treated as invalid: that row was removed from the table (getInvalidRows() lists them)
  fix     1. find the throwing refinement / transform in the schema: the original error is context.cause (passed to onDiagnostic)
          2. make custom checks return an issue (e.g. ctx.addIssue / a refine predicate) instead of throwing on unexpected input
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_schema_crashed
  context trigger=data-change run=0 phase=client
```

## Features

### DK_FILTER_TYPE_MISMATCH

`warn` · fault test: [column-filters.test.ts](../../packages/core/src/features/column-filters/column-filters.test.ts)

**Problem.** A column filter compares values of one type, but the cells or the filter value have another. With `source: 'cell'`, the cells of the wrong type are treated as non-matching and the other rows are filtered normally; with `source: 'filter'`, the filter value itself is malformed (or the filter kind is unknown) and the filter matches no rows until it is fixed.

**Common causes.**

- Numbers or dates that arrive as strings (CSV, form inputs, some JSON APIs).
- A filter value taken from an input without conversion (`'40'` for a `range`).
- A filter kind typo (`type: 'contain'`).

**Fix.**

- Convert the filter value before setting it (`Number(input)`, `new Date(input)`).
- Normalise the column with an `accessor` that returns the right type.
- Or use a filter kind that fits the cells, or a `custom` filter `fn`.

**Example.**

```ts
import { columnFilters, createTable } from '@datakable/core'

// `age` arrives as strings from a CSV / form API.
const users = [
  { id: 1, name: 'Ada', age: '36' },
  { id: 2, name: 'Grace', age: '45' },
]

const table = createTable({ data: users, features: [columnFilters()] })
// @ts-expect-error a range filter needs number cells; TypeScript sees the string column too
table.setColumnFilter('age', { type: 'range', value: { min: 40 } })
table.getRowModel()
```

prints (development console):

```text
⚠ [DataKable table#1] DK_FILTER_TYPE_MISMATCH: the "range" filter on column "age" compares number | bigint values, but 2 cells hold another type (first: string) (rows #0, #1)
  where   columns[2] (id "age")
  impact  those rows are treated as non-matching; the other rows are filtered normally
  fix     1. if the filter value is the wrong type, convert it before setting it: Number(input)
          2. if the data is the wrong type, normalise the column: { id: 'age', accessor: (row) => Number(row.<field>) } (columns[2])
          3. or filter with a kind that fits string cells, or a custom filter: { type: 'custom', value, fn: (cell, value, row) => boolean }
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_filter_type_mismatch
  context trigger=api:setColumnFilter run=1 phase=client
```

### DK_SORT_COMPARATOR_INVALID

`warn` · development only · fault test: [slots.test.ts](../../packages/core/src/fault-injection/slots.test.ts)

**Problem.** A column's `sortFn` returned `NaN` or a non-number, or is inconsistent (`sortFn(a, b)` and `sortFn(b, a)` do not have opposite signs). The column is sorted with the default comparator instead. Checked on a sample of pairs, in development.

**Common causes.**

- A lookup table that misses a value (`rank[a] - rank[b]` with `rank.low` undefined).
- Returning a boolean (`a > b`) instead of a number.
- Comparing objects without a field (`a - b` on objects).

**Fix.**

- Return a finite number: negative (a first), positive (b first) or 0.
- Or sort by a primitive key with `sortBy: (row) => …` instead of a comparator.

**Example.**

```ts
import { createTable, sorting } from '@datakable/core'

const tasks = [
  { id: 1, title: 'Ship', priority: 'high' },
  { id: 2, title: 'Test', priority: 'low' },
  { id: 3, title: 'Plan', priority: 'medium' },
]
const rank: Record<string, number> = { high: 0, medium: 1 } // 'low' is missing

const table = createTable({
  data: tasks,
  columns: [
    { key: 'title' },
    // rank.low is undefined: undefined - 0 is NaN
    { key: 'priority', sortFn: (a, b) => (rank[a] as number) - (rank[b] as number) },
  ],
  features: [sorting()],
})
table.toggleSort('priority')
table.getRowModel()
```

prints (development console):

```text
⚠ [DataKable table#1] DK_SORT_COMPARATOR_INVALID: columns[1].sortFn (column "priority") returned NaN
  where   options.columns[1].sortFn
  impact  the column was sorted with the default comparator instead
  fix     1. return a finite number from sortFn: negative (a first), positive (b first) or 0, e.g. (a, b) => a.rank - b.rank
          2. or sort by a primitive key instead: columns[1].sortBy: (row) => row.<field>
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_sort_comparator_invalid
  context trigger=api:toggleSort run=1 phase=client
```

### DK_SORT_STRATEGY

`info` · fault test: [strategy.test.ts](../../packages/core/src/features/sorting/strategy.test.ts)

**Problem.** Information, reported only with `sorting({ debug: true })`: which algorithm sorted the rows (`tim`, `radix`, `counting`, `native` or `custom`), why it was chosen, and how long it took.

**Common causes.**

- `sorting({ debug: true })` is set (to investigate sort performance).

**Fix.**

- Force an algorithm with `sorting({ algorithm })` or a column's `sortAlgorithm`, if the automatic choice is slower for your data.
- Remove `debug: true` to stop the reports.

**Example.**

```ts
import { createTable, sorting } from '@datakable/core'

const users = Array.from({ length: 1000 }, (_, i) => ({ id: i, age: (i * 7919) % 90 }))

const table = createTable({ data: users, features: [sorting({ debug: true })] })
table.toggleSort('age')
table.getRowModel()
```

prints (development console):

```text
ℹ [DataKable table#1] DK_SORT_STRATEGY: sorted 1000 rows by age:asc with counting in 0.55 ms (auto: safe integers, key range 90 ≤ 4n)
  where   columns[1] (id "age")
  impact  none; reported because sorting({ debug: true }) is set
  fix     1. to force an algorithm: sorting({ algorithm: 'tim' | 'radix' | 'counting' | 'native' }) or a column's sortAlgorithm
          2. remove debug: true from sorting() to stop these reports
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_sort_strategy
  context trigger=api:toggleSort run=1 phase=client
```

### DK_SEARCH_FAILED

`error` · fault test: [slots.test.ts](../../packages/core/src/fault-injection/slots.test.ts)

**Problem.** `search({ searchFn: withSearchFn(fn) })`'s `fn` rejected or threw, or resolved with something that is neither an array of rows (from `ctx.rows`) nor `{ keys }`. The previous search results are kept (or the rows are shown unsearched if there were none) and the status is `'error'`. `where` is `options.searchFn` (the `searchFn` option of `search()`).

**Common causes.**

- The search service is down or returns an error status.
- The response is passed through unmapped (`{ hits: [...] }` instead of rows or keys).

**Fix.**

- Check the request `searchFn` sends; the original error is `context.cause` in `onDiagnostic`.
- Return `ctx.rows.filter(...)` or `{ keys: [...] }` with the `rowKey` values of the matches.
- Retry with `table.flushSearch()`; the next query change runs `searchFn` again. (`table.refetch()` retries a server-mode `fetcher`.)

**Example.**

```ts
import { createTable, search } from '@datakable/core'
import { withSearchFn } from '@datakable/core/search-async'

type User = { id: number; name: string }
const users: User[] = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Grace' },
]

const table = createTable({
  data: users,
  rowKey: 'id',
  features: [
    search<User>({
      // A search service that is down.
      searchFn: withSearchFn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    }),
  ],
})
await table.setSearch('ada')
```

prints (development console):

```text
✖ [DataKable table#1] DK_SEARCH_FAILED: searchFn rejected or threw TypeError
  where   options.searchFn
  impact  the rows are shown unsearched (status: 'error')
  fix     1. check the request searchFn sends (the original error is context.cause, passed to onDiagnostic)
          2. retry from the UI with flushSearch(); the next query change runs searchFn again
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_search_failed
  context trigger=fetch run=1 phase=client
```

### DK_INVALID_PAGINATION

`warn` · fault test: [pagination.test.ts](../../packages/core/src/features/pagination/pagination.test.ts)

**Problem.** `setPageIndex()` / `setPageSize()`, or the pagination state (from `initialState`, `setState` or a controlled `state`), got a value that is not an integer in range (`pageIndex` ≥ 0, `pageSize` > 0). A method call is ignored; a bad state slice is replaced with a valid one. In a production build, an invalid `pagination({ pageSize })` option is reported here too (`where: { kind: 'feature', name: 'pagination' }`) and replaced with the default of 10; development builds throw `DK_INVALID_OPTION` at creation instead.

**Common causes.**

- A value read from an input or the URL without conversion (`'20'`, `NaN`, `'All'`).
- A page size of 0, or a fractional page.

**Fix.**

- Pass integers: `table.setPageSize(Number(value))` after checking it is a number.
- Use `setPageIndex(i)`: it clamps to the existing pages. For "show all", use a large page size or remove `pagination()`.

**Example.**

```ts
import { createTable, pagination } from '@datakable/core'

const users = Array.from({ length: 100 }, (_, i) => ({ id: i }))
const table = createTable({ data: users, features: [pagination({ pageSize: 25 })] })

const selected = 'All' // e.g. a <select> option value
table.setPageSize(Number(selected)) // NaN: ignored, the page size stays 25
```

prints (development console):

```text
⚠ [DataKable table#1] DK_INVALID_PAGINATION: setPageSize() received NaN; pageSize must be an integer > 0
  where   operation table.setPageSize
  impact  the call was ignored
  fix     1. pass an integer > 0 to setPageSize()
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_invalid_pagination
  context trigger=api:setPageSize run=0 phase=client
```

### DK_INVALID_VALIDITY

`warn` · fault test: [validity.test.ts](../../packages/core/src/features/validity/validity.test.ts)

**Problem.** `setValidity()`, or the validity state, got a value other than `'all' | 'valid' | 'invalid'`. A method call is ignored; a bad state reads as `'all'`.

**Common causes.**

- A UI label used as the value (`'Invalid'`, `'Valid only'`).
- A value read from the URL or storage without checking it.

**Fix.**

- Pass one of `'all'`, `'valid'`, `'invalid'` (map your labels to them).

**Example.**

```ts
import { createTable, type StandardSchemaV1, type ValidityState, validity } from '@datakable/core'
import { withSchema } from '@datakable/core/schema'

type User = { id: number; email: string }
// Any Standard Schema v1 (zod, valibot, arktype, …); a hand-written one here.
const UserSchema: StandardSchemaV1<unknown, User> = {
  '~standard': {
    version: 1,
    vendor: 'example',
    validate: (v) =>
      typeof (v as User).email === 'string'
        ? { value: v as User }
        : { issues: [{ message: 'email is required', path: ['email'] }] },
  },
}

const table = createTable({
  data: [{ id: 1, email: 'ada@example.com' }, { id: 2 }],
  schema: withSchema(UserSchema),
  invalidRows: 'flag',
  features: [validity()],
})

const option = 'Invalid' // e.g. a <select> label used as the value
table.setValidity(option as ValidityState) // ignored: the filter stays 'all'
```

prints (development console):

```text
⚠ [DataKable table#1] DK_INVALID_VALIDITY: setValidity() received "Invalid"; it must be 'all' | 'valid' | 'invalid'
  where   operation table.setValidity
  impact  the call was ignored; the validity filter is unchanged
  fix     1. pass 'all' | 'valid' | 'invalid' to setValidity()
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_invalid_validity
  context trigger=api:setValidity run=0 phase=client
```

## Async

### DK_FETCH_FAILED

`error` · fault test: [slots.test.ts](../../packages/core/src/fault-injection/slots.test.ts)

**Problem.** The `fetcher` rejected or threw. The previous rows are kept (`status: 'error'`); on the first request nothing is shown yet (`status: 'error'`, `isInitialLoad: true`). Only `error.name` is logged; the error itself is `context.cause`.

**Common causes.**

- The API is unreachable, returns an error status, or the user is offline.
- The fetcher throws on a non-OK response (`if (!res.ok) throw …`), as it should.

**Fix.**

- Check the request the fetcher sends; the original error is `context.cause` in `onDiagnostic`.
- Offer a retry: `table.refetch()` (never rejects; `<DataTable />`'s Error state has a Retry button). The next state change (page, sort, filter, query) also fetches again.

**Example.**

```ts
import { createTable, type FetchResult, pagination } from '@datakable/core'
import { withFetcher } from '@datakable/core/server'

type User = { id: number; name: string }

createTable({
  rowKey: 'id',
  features: [pagination({ mode: 'server' })],
  fetcher: withFetcher(async (): Promise<FetchResult<User>> => {
    throw new TypeError('Failed to fetch') // e.g. the API is unreachable
  }),
})
```

prints (development console):

```text
✖ [DataKable table#1] DK_FETCH_FAILED: fetcher rejected or threw TypeError
  where   options.fetcher
  impact  nothing is shown yet (status: 'error', isInitialLoad: true)
  fix     1. check the request the fetcher sends (the original error is context.cause, passed to onDiagnostic)
          2. retry from the UI with table.refetch(); the next state change (page, sort, filter, query) or a new fetcher also runs it again
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_fetch_failed
  context trigger=fetch run=1 phase=client
```

### DK_FETCH_ABORTED

`info` · fault test: [fetcher.test.ts](../../packages/core/src/source/fetcher.test.ts)

**Problem.** Information: a fetcher request was superseded by a newer one (latest wins). Its result is ignored and its `signal` was aborted. Info level: printed in development, kept in `getDiagnostics()` in production.

**Common causes.**

- The state changed while a request was in flight (typing, quick page changes, a sort click).

**Fix.**

- Nothing to fix. Pass `signal` to `fetch()` so superseded requests also stop on the network.

**Example.**

```ts
import { createTable, type FetchResult, sorting } from '@datakable/core'
import { withFetcher } from '@datakable/core/server'

type User = { id: number; name: string }

const table = createTable({
  rowKey: 'id',
  features: [sorting({ mode: 'server' })],
  fetcher: withFetcher(
    ({ signal }) =>
      new Promise<FetchResult<User>>((resolve) => {
        const timer = setTimeout(() => resolve({ rows: [], rowCount: 0 }), 50)
        signal.addEventListener('abort', () => clearTimeout(timer))
      }),
  ),
})
table.toggleSort('name') // a new request supersedes the first one
```

prints (development console):

```text
ℹ [DataKable table#1] DK_FETCH_ABORTED: a fetcher request was superseded by a newer one (latest wins)
  where   options.fetcher
  impact  its result is ignored; the request was aborted through ctx.signal
  fix     1. nothing to fix; pass params.signal to fetch() so superseded requests stop on the network
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_fetch_aborted
  context trigger=fetch run=2 phase=client
```

### DK_FETCH_BAD_RESPONSE

`error` · fault test: [slots.test.ts](../../packages/core/src/fault-injection/slots.test.ts)

**Problem.** The `fetcher` resolved with something other than `{ rows: T[], rowCount: number }`, or `rowCount` is missing (server pagination needs the total), not an integer ≥ 0, or smaller than `rows.length`. The result is ignored and the previous rows are kept (`status: 'error'`). In server mode `filteredCount` is the number of rows on the current page and `rowCount` is the server total.

**Common causes.**

- The API response is returned unmapped (`{ items, total }`, `{ data, count }`).
- `rowCount` set to the page size instead of the total.

**Fix.**

- Map the response in the fetcher: `return { rows: r.items, rowCount: r.total }`.
- Return the total number of matching rows on the server as `rowCount`.

**Example.**

```ts
import { createTable, type FetchResult, pagination } from '@datakable/core'
import { withFetcher } from '@datakable/core/server'

type User = { id: number; name: string }

createTable({
  rowKey: 'id',
  features: [pagination({ mode: 'server' })],
  // The API answers { items, total }; the fetcher returns it as is.
  fetcher: withFetcher(
    async () => ({ items: [{ id: 1, name: 'Ada' }], total: 1 }) as unknown as FetchResult<User>,
  ),
})
```

prints (development console):

```text
✖ [DataKable table#1] DK_FETCH_BAD_RESPONSE: fetcher result.rows is undefined, not an array
  where   options.fetcher
  impact  the result was ignored and the previous rows are kept (status: 'error')
  fix     1. resolve the fetcher with { rows: T[], rowCount: number } (rowCount = the total number of matching rows on the server)
          2. map your API response in the fetcher: async (p) => { const r = await api(p); return { rows: r.items, rowCount: r.total } }
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_fetch_bad_response
  context trigger=fetch run=1 phase=client
```

### DK_ASYNC_TIMEOUT

`error` · fault test: [async-control.test.ts](../../packages/core/src/source/async-control.test.ts)

**Problem.** An async operation (`fetcher`, `searchFn`) did not settle within `timeout` (default 30 s). The request is aborted through its `signal`, a late result is ignored, and the previous results are kept (`status: 'error'`).

**Common causes.**

- A slow or hanging API.
- A `timeout` set too low for the work (large pages, cold starts).

**Fix.**

- Make the request faster (smaller pages, an index), or raise `timeout` (`Infinity` disables it).
- Pass `signal` to `fetch()` so the timed-out request is cancelled on the network too.

**Example.**

```ts
import { createTable, pagination } from '@datakable/core'
import { withFetcher } from '@datakable/core/server'

createTable({
  features: [pagination({ mode: 'server' })],
  // An API that never answers.
  fetcher: withFetcher(() => new Promise(() => {})),
  timeout: 50, // ms; the default is 30 s
})
```

prints (development console):

```text
✖ [DataKable table#1] DK_ASYNC_TIMEOUT: fetcher did not settle within the timeout (50 ms)
  where   options.fetcher
  impact  the request was aborted and its late result is ignored; the previous results were kept (status: 'error')
  fix     1. make fetcher answer faster (smaller pages, a server-side index), or raise `timeout` (now 50 ms)
          2. pass ctx.signal to fetch() inside fetcher so the timed-out request is cancelled on the network too
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_async_timeout
  context trigger=fetch run=0 phase=client
```

### DK_ROW_COUNT_MISSING

`warn` · fault test: [pagination.test.ts](../../packages/core/src/features/pagination/pagination.test.ts)

**Problem.** `pagination({ mode: 'server' })` without a `fetcher` (you pass each page as `data`) and without a `rowCount` option: the total number of rows is unknown. The page count falls back to `data.length` (one page) and `canNextPage()` is `false`.

**Common causes.**

- Server pagination where the page is loaded by your own code and the total is not passed on.

**Fix.**

- Pass the total with each page: `setOptions({ data: page.rows, rowCount: page.total })`.
- Or give the table a `fetcher` that resolves `{ rows, rowCount }`, or use `pagination({ mode: 'client' })` with all rows as `data`.

**Example.**

```ts
import { createTable, pagination } from '@datakable/core'

// Server pagination with the page passed as data (no fetcher), but no total.
const page = [
  { id: 21, name: 'Ada' },
  { id: 22, name: 'Grace' },
]

const table = createTable({ data: page, features: [pagination({ mode: 'server', pageSize: 20 })] })
table.getPageCount() // 1: the total is unknown
```

prints (development console):

```text
⚠ [DataKable table#1] DK_ROW_COUNT_MISSING: pagination is in server mode, but there is no fetcher and no rowCount option: the total number of rows is unknown
  where   options.rowCount
  impact  the page count falls back to data.length (2) as the total: one page, canNextPage() is false
  fix     1. pass the total from your API: setOptions({ data: page.rows, rowCount: page.total })
          2. or pass a fetcher that resolves { rows, rowCount }, or use pagination({ mode: 'client' }) with all rows as data
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_row_count_missing
  context trigger=api:getPageCount run=1 phase=client
```

## Callbacks and plugins

### DK_CALLBACK_FAILED

`error` · fault test: [slots.test.ts](../../packages/core/src/fault-injection/slots.test.ts)

**Problem.** A callback you passed threw: a column `accessor` / `format` / `sortBy` / `sortFn` / `cell` / filter `fn`, `rowKey`, `fetcher`, `searchFn`, an updater passed to `setState`, … `where` names the slot (`options.columns[1].accessor`, or `operation table.setState at updater`). The slot's fallback is applied (`undefined` for an accessor, `''` for a format, non-matching for a filter, `#index` for a row key, `⚠` for a cell) and the rest of the table keeps working.

**Common causes.**

- `null` / `undefined` / unexpected values in some rows (`total.toFixed()` on `null`).
- A callback written for another row shape.

**Fix.**

- Make the callback total: guard `null` / `undefined` / unexpected types and return a fallback instead of throwing.
- Reproduce with `table.explainRow(key)` on the reported row; the error is `context.cause` in `onDiagnostic`.

**Example.**

```ts
import { createTable } from '@datakable/core'

type Order = { id: number; total: number | null }
const orders: Order[] = [
  { id: 1, total: 9.5 },
  { id: 2, total: null }, // not priced yet
  { id: 3, total: 12 },
]

const table = createTable({
  data: orders,
  columns: [
    { key: 'id' },
    { id: 'total', accessor: (order) => (order.total as number).toFixed(2) }, // throws on null
  ],
})
table.getRowModel().rows[1]?.getValue('total') // undefined; the other rows are fine
```

prints (development console):

```text
✖ [DataKable table#1] DK_CALLBACK_FAILED: columns[1].accessor (column "total") threw TypeError for 1 row (rows #1)
  where   options.columns[1].accessor
  impact  the cell reads as undefined; the rest of the table is unaffected
  fix     1. make columns[1].accessor total: guard null / undefined / unexpected types and return a fallback instead of throwing
          2. reproduce with table.explainRow() on row #1; the original error is context.cause
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_callback_failed
  context trigger=init run=1 phase=client
```

### DK_CALLBACK_BAD_RETURN

`warn` · development only · fault test: [slots.test.ts](../../packages/core/src/fault-injection/slots.test.ts)

**Problem.** A callback broke its return contract (`defineSlot`): `format` returned a non-string, `cell` / `invalidCell` returned a Promise, `sortAlgorithm` returned something that is not an algorithm, … The value is coerced, or the slot's fallback is used. Checked per column batch, in development.

**Common causes.**

- `format` returning a number (`(v) => v * 100`) or markup.
- An async `cell` / `format` (a Promise is not renderable).

**Fix.**

- Return the contract type: a string from `format` (`(v) => String(v)`, `(v) => v.toFixed(2)`).
- Compute async values before the table, or render markup with `cell`.

**Example.**

```ts
import { createTable, search } from '@datakable/core'

const products = [
  { sku: 'A-1', price: 9.5 },
  { sku: 'B-2', price: 12 },
]

const table = createTable({
  data: products,
  // A format that returns a number (cents) instead of a string.
  columns: [{ key: 'sku' }, { key: 'price', format: ((v: number) => v * 100) as never }],
  features: [search()],
})
await table.setSearch('950')
```

prints (development console):

```text
⚠ [DataKable table#1] DK_CALLBACK_BAD_RETURN: columns[1].format (column "price") returned a number instead of a string for 2 rows (rows #0, #1)
  where   options.columns[1].format
  impact  those cells were coerced with the default formatter
  fix     1. return a string from columns[1].format, e.g. (v) => String(v) or (v) => v.toFixed(2)
          2. if columns[1].format is async or returns markup, compute the value before the table (or render it with cell)
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_callback_bad_return
  context trigger=api:setSearch run=1 phase=client
```

### DK_FEATURE_FAILED

`error` · fault test: [slots.test.ts](../../packages/core/src/fault-injection/slots.test.ts)

**Problem.** A feature's `rowModel()`, `createApi()` or `initialState()` threw. `rowModel`: the step passes its input through (the feature has no effect this run). `createApi`: the feature's methods are missing from the table. `initialState`: its state slice starts `undefined`. Calling a missing method later reports `DK_FEATURE_FAILED` again in development (naming the method); in production it is a plain `TypeError` (`table.x is not a function`).

**Common causes.**

- A plugin (`defineFeature`) that does not handle every row or option value.
- A plugin built against another version of core.

**Fix.**

- Fix the throwing hook: it must not throw (`rowModel` returns its input indices when it cannot filter). The error is `context.cause` in `onDiagnostic`.
- For a missing method, look for the first `DK_FEATURE_FAILED` of that feature (trigger `init`).

**Example.**

```ts
import { createTable, defineFeature } from '@datakable/core'

// A plugin whose filter step throws on rows it did not expect.
const onlyActive = defineFeature({
  name: 'onlyActive',
  stage: 'filter',
  initialState: () => ({}),
  createApi: () => ({}),
  rowModel: (indices) => {
    throw new TypeError(`cannot read 'active' of ${indices.length} rows`)
  },
})

const table = createTable({ data: [{ id: 1 }, { id: 2 }], features: [onlyActive] })
table.getRowModel() // both rows: the step passed its input through
```

prints (development console):

```text
✖ [DataKable table#1] DK_FEATURE_FAILED: feature "onlyActive" rowModel() threw TypeError
  where   feature "onlyActive"
  impact  the step passed its input through; the rest of the table is unaffected
  fix     1. fix rowModel() of feature "onlyActive": it must not throw (return its input indices when it cannot filter)
          2. the original error is context.cause (passed to onDiagnostic)
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_feature_failed
  context trigger=init run=1 phase=client
```

### DK_FEATURE_BAD_OUTPUT

`error` · development only · fault test: [slots.test.ts](../../packages/core/src/fault-injection/slots.test.ts)

**Problem.** A feature's `rowModel()` returned something other than a `Uint32Array` of row indices, or an index out of range. The step passes its input through. Checked in development.

**Common causes.**

- Returning a plain array (`Array.from(indices).filter(…)`).
- Returning a Promise (rowModel is synchronous).
- Indices computed from another data array.

**Fix.**

- Return a `Uint32Array`: `indices.subarray(0, n)`, a new `Uint32Array(n)` you fill, or `Uint32Array.from(list)`.
- Return only indices taken from the input.

**Example.**

```ts
import { createTable, defineFeature } from '@datakable/core'

const users = [
  { id: 1, active: true },
  { id: 2, active: false },
]

// rowModel must return a Uint32Array of row indices, not a plain array.
const onlyActive = defineFeature({
  name: 'onlyActive',
  stage: 'filter',
  initialState: () => ({}),
  createApi: () => ({}),
  rowModel: (indices) =>
    Array.from(indices).filter((i) => users[i]?.active) as unknown as Uint32Array,
})

createTable({ data: users, features: [onlyActive] }).getRowModel()
```

prints (development console):

```text
✖ [DataKable table#1] DK_FEATURE_BAD_OUTPUT: feature "onlyActive" rowModel() returned an Array, not a Uint32Array of row indices
  where   feature "onlyActive"
  impact  the step passed its input through (the feature had no effect this run)
  fix     1. return a Uint32Array of row indices from rowModel() of feature "onlyActive": indices.subarray(0, n), a new Uint32Array(n) you filled, or Uint32Array.from(list)
          2. rowModel() is synchronous; return the input indices when the feature is inactive
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_feature_bad_output
  context trigger=init run=1 phase=client
```

### DK_FEATURE_MUTATED_INPUT

`warn` · development only · fault test: [dev-checks.test.ts](../../packages/core/src/pipeline/dev-checks.test.ts)

**Problem.** A feature's `rowModel()` wrote to its input indices. The input is the previous step's memoised output, so later runs can show rows in the wrong order or the wrong rows. The output is still used. Checked on a sample of positions, in development.

**Common causes.**

- `indices.sort(…)` / `indices.reverse()` (in place) instead of a copy.

**Fix.**

- Copy first: `indices.slice().sort(…)`, or write into a new `Uint32Array`.

**Example.**

```ts
import { createTable, defineFeature } from '@datakable/core'

// Sorts its input in place: the input is the previous step's (memoised) output.
const newestFirst = defineFeature({
  name: 'newestFirst',
  stage: 'sort',
  initialState: () => ({}),
  createApi: () => ({}),
  rowModel: (indices) => indices.sort((a, b) => b - a),
})

createTable({ data: [{ id: 1 }, { id: 2 }, { id: 3 }], features: [newestFirst] }).getRowModel()
```

prints (development console):

```text
⚠ [DataKable table#1] DK_FEATURE_MUTATED_INPUT: feature "newestFirst" rowModel() wrote to its input indices
  where   feature "newestFirst"
  impact  the input is the previous step's memoised output: later runs can show rows in the wrong order or the wrong rows until the data changes
  fix     1. copy before changing in feature "newestFirst": indices.slice().sort(...) instead of indices.sort(...)
          2. or write the result into a new Uint32Array
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_feature_mutated_input
  context trigger=init run=1 phase=client
```

### DK_INTERCEPTOR_FAILED

`error` · fault test: [slots.test.ts](../../packages/core/src/fault-injection/slots.test.ts)

**Problem.** An interceptor threw. It is skipped for that call (its `next` is called directly), so the operation still runs; the original error is `context.cause`.

**Common causes.**

- An interceptor that depends on something not ready yet (an analytics client, a router).
- Reading `ctx.input` fields of another operation (an interceptor on `'*'`).

**Fix.**

- Catch errors inside the interceptor and always return `next()` (or a valid result).
- Attach it only to the operations it handles (`on: ['state:dispatch']`).

**Example.**

```ts
import { createTable, defineInterceptor, sorting } from '@datakable/core'

declare const analytics: { track(event: string): void } | undefined // not loaded yet

const tracking = defineInterceptor({
  name: 'tracking',
  on: ['state:dispatch'],
  intercept(ctx, next) {
    ;(analytics as { track(event: string): void }).track(ctx.op) // throws while undefined
    return next()
  },
})

const table = createTable({
  data: [{ id: 1, name: 'Ada' }],
  features: [sorting()],
  interceptors: [tracking],
})
table.toggleSort('name') // still sorts: the interceptor is skipped
```

prints (development console):

```text
✖ [DataKable table#1] DK_INTERCEPTOR_FAILED: interceptor "tracking" threw on state:dispatch (at sorting)
  where   interceptor "tracking" on state:dispatch
  impact  the interceptor was skipped for this call; the operation ran without it
  fix     1. catch errors inside "tracking" and always return next() (or a valid result)
          2. see context.cause for the original error
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_interceptor_failed
  context trigger=api:toggleSort run=0 phase=client
```

### DK_HOT_INTERCEPTOR

`warn` · development only · fault test: [runtime.test.ts](../../packages/core/src/intercept/runtime.test.ts)

**Problem.** An interceptor is attached to a hot operation (`column:batch`, also through `on: '*'`) without `hot: true`. It still runs, once per column per pipeline run; the warning states the measured cost. Development only.

**Common causes.**

- A logging / timing interceptor with `on: '*'`.
- A cell-level interceptor written without knowing `column:batch` is hot.

**Fix.**

- Set `hot: true` to accept the cost (and never loop per cell inside it).
- Or list only the cold operations it needs in `on`.

**Example.**

```ts
import { createTable, defineInterceptor } from '@datakable/core'

// '*' includes column:batch, which runs once per column on every pipeline run.
const timing = defineInterceptor({
  name: 'timing',
  on: '*',
  intercept(ctx, next) {
    const start = performance.now()
    const out = next()
    console.debug(ctx.op, performance.now() - start)
    return out
  },
})

createTable({ data: [{ id: 1 }], interceptors: [timing] })
```

prints (development console):

```text
⚠ [DataKable table#1] DK_HOT_INTERCEPTOR: interceptor "timing" is attached to hot op "column:batch" without hot: true
  where   interceptor "timing" on column:batch
  impact  it runs once per column per pipeline run; measured cost: ~10 ns per call per interceptor (+15% on a per-cell format call, spec §9.2) on top of the interceptor body, which runs columns × pipeline runs times. It still runs (dev-only warning).
  fix     1. set hot: true on "timing" to accept the cost, and never loop per cell inside it
          2. attach "timing" to cold ops only (list them in `on` instead of '*' / 'column:batch')
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_hot_interceptor
  context trigger=init run=0 phase=client
```

### DK_OPERATION_CONFLICT

`error` · config: thrown at creation · fault test: [boundary.test.ts](../../packages/core/src/intercept/boundary.test.ts)

**Problem.** `registerOperation(name, …)` was called for a name already registered with another `kind` or `hot` flag. The registration is rejected (`DatakableConfigError`); the first one stays in effect. The operation registry is process-wide.

**Common causes.**

- Two plugins that use the same operation name for different things.
- Two versions of one plugin in the bundle.

**Fix.**

- Register the operation with the same contract everywhere.
- Or give each plugin's operation its own namespace (`myplugin:export`).

**Example.**

```ts
import { registerOperation } from '@datakable/core'

declare module '@datakable/core' {
  interface Operations {
    'export:csv': { kind: 'sync'; input: { rows: number }; output: string }
  }
}

// Two plugins register the same operation with different contracts.
registerOperation('export:csv', { kind: 'sync', hot: false }) // plugin A
registerOperation('export:csv', { kind: 'sync', hot: true }) // plugin B
```

throws:

```text
DatakableConfigError: DK_OPERATION_CONFLICT: operation "export:csv" is already registered as sync; got sync (hot)
  where   operation export:csv
  fix     1. register "export:csv" with the same kind and hot flag (sync, hot: false)
          2. or give the new operation its own name, e.g. "myplugin:csv"
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_operation_conflict
```

### DK_LISTENER_FAILED

`error` · fault test: [slots.test.ts](../../packages/core/src/fault-injection/slots.test.ts)

**Problem.** A `table.subscribe(listener)` listener threw while being notified. The other listeners still run and the state change is committed.

**Common causes.**

- A UI update in the listener that throws (a component unmounted, a missing element).

**Fix.**

- Catch errors inside the listener; listeners must not throw. The error is `context.cause` in `onDiagnostic`.

**Example.**

```ts
import { createTable, sorting } from '@datakable/core'

const users = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Grace' },
]
const table = createTable({ data: users, features: [sorting()] })

table.subscribe(() => {
  throw new Error('render failed') // e.g. a UI update that throws
})
table.toggleSort('name')
```

prints (development console):

```text
✖ [DataKable table#1] DK_LISTENER_FAILED: subscribe listener #1 threw Error while being notified of a state change
  where   operation table.subscribe at listener #1
  impact  the other listeners still ran; the state change is committed
  fix     1. catch errors inside listener #1 (the 1. subscribe call); listeners must not throw
          2. the original error is context.cause (passed to onDiagnostic)
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_listener_failed
  context trigger=api:toggleSort run=1 phase=client
```

## Options and config

### DK_UNKNOWN_OPTION

`warn` · development only · fault test: [options.test.ts](../../packages/core/src/catalog/options.test.ts)

**Problem.** An option key is not an option of the table (or of the feature it was passed to). It is ignored. The fix suggests the closest name, and names the feature that owns the option when it was passed to the table instead.

**Common causes.**

- A typo (`colums`), or an option from another table library.
- A feature option passed to `createTable` (`pageSize` instead of `pagination({ pageSize })`).

**Fix.**

- Rename it to the suggested option, or pass it to the feature that owns it.
- TypeScript reports unknown options too (excess property checks on object literals).

**Example.**

```ts
import { createTable } from '@datakable/core'

const users = [{ id: 1, name: 'Ada' }]

// @ts-expect-error `colums` is not an option: TypeScript catches the typo too
createTable({ data: users, colums: [{ key: 'name' }] })
```

prints (development console):

```text
⚠ [DataKable table#1] DK_UNKNOWN_OPTION: unknown option "colums"
  where   options.colums
  impact  the option is ignored
  fix     1. did you mean "columns"? rename "colums" to "columns"
          2. remove "colums"; accepted options here: name, data, columns, schema, invalidRows, rowKey, features, initialState, state, onStateChange, interceptors, onDiagnostic, timeout, fetcher, rowCount, initialData, strict, diagnostics
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_unknown_option
  context trigger=init run=0 phase=client
```

### DK_INVALID_OPTION

`error` · development only, except the unwrapped `schema` / `fetcher` / `searchFn` guard (every build) · config: thrown at creation · fault test: [options.test.ts](../../packages/core/src/catalog/options.test.ts), [options.prod.test.ts](../../packages/core/src/table/options.prod.test.ts)

**Problem.** An option has the wrong runtime type or is out of range. At creation the table is not created (`DatakableConfigError`); in `setOptions()` the call is rejected and the previous options are kept. The fix names the accepted values (and the closest one, for enums).

**Common causes.**

- Values read from the environment, the URL or JSON without conversion (`timeout: Number('30s')`).
- Untyped (JavaScript) configuration.
- A `schema`, `fetcher` or `searchFn` passed without its opt-in wrapper (`withSchema()` from `@datakable/core/schema`, `withFetcher()` from `@datakable/core/server`, `withSearchFn()` from `@datakable/core/search-async`). This one is also thrown in production builds.

**Fix.**

- Pass a value of the accepted type, or leave the option out for its default.
- Wrap it: `schema: withSchema(UserSchema)`, `fetcher: withFetcher(fetchUsers)`, `search({ searchFn: withSearchFn(fn) })`.

**Example.**

```ts
import { createTable } from '@datakable/core'

const users = [{ id: 1, name: 'Ada' }]
const timeout = Number('30s') // NaN, e.g. read from an env variable

createTable({ data: users, timeout })
```

throws:

```text
DatakableConfigError: DK_INVALID_OPTION: options.timeout must be a number of milliseconds > 0, or Infinity to disable the timeout, got NaN
  where   options.timeout
  fix     1. pass a number of milliseconds > 0, or Infinity to disable the timeout as options.timeout, or leave it out for the default
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_invalid_option
```

### DK_OPTION_NO_EFFECT

`warn` · fault test: [options.test.ts](../../packages/core/src/catalog/options.test.ts)

**Problem.** An option is valid but ignored in this configuration (`invalidRows` without `schema`, `rowCount` with a `fetcher` or without server pagination, `initialData` with `data`, …). Also reported when `setOptions()` changes a read-once option: `name`, `schema`, `invalidRows`, `features`, `initialState`, `timeout`, `initialData`, `strict` and `diagnostics` keep the value the table was created with. The option validator's reports are development only; a feature's own (a `search` with no searchable column, `validity` outside flag mode) are reported in every build, and a production `setOptions` still keeps the read-once values.

**Common causes.**

- Leftover options after a refactor.
- Changing a read-once option with `setOptions()` (e.g. a new `features` array).

**Fix.**

- Remove the option, or change the configuration so that it applies.
- For a read-once option, create a new table (in React, change the component `key`).

**Example.**

```ts
import { createTable } from '@datakable/core'

const users = [{ id: 1, name: 'Ada' }]

// `flag` keeps rows that fail options.schema, and no schema is set.
createTable({ data: users, invalidRows: 'flag' })
```

prints (development console):

```text
⚠ [DataKable table#1] DK_OPTION_NO_EFFECT: options.invalidRows has no effect: invalidRows: 'flag' applies to rows that fail options.schema, and no schema is set
  where   options.invalidRows
  impact  the option is ignored in this configuration
  fix     1. remove options.invalidRows, or change the configuration so that it applies (invalidRows: 'flag' applies to rows that fail options.schema, and no schema is set)
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_option_no_effect
  context trigger=init run=0 phase=client
```

### DK_MODE_ORDER

`error` · development only · config: thrown at creation · fault test: [fetcher.test.ts](../../packages/core/src/source/fetcher.test.ts)

**Problem.** A client-mode feature runs before a server-mode one in the pipeline (filter → search → sort → paginate). The client step would only see the rows the server returned, so the table is not created.

**Common causes.**

- Server pagination with client sorting or filtering.

**Fix.**

- Move the earlier feature to the server too (`sorting({ mode: 'server' })`).
- Or handle the later feature in the client (`pagination({ mode: 'client' })`).

**Example.**

```ts
import { createTable, pagination, sorting } from '@datakable/core'
import { withFetcher } from '@datakable/core/server'

createTable({
  // Sorting in the browser, but paging on the server: the client sort would see one page only.
  features: [sorting(), pagination({ mode: 'server' })],
  fetcher: withFetcher(async () => ({ rows: [], rowCount: 0 })),
})
```

throws:

```text
DatakableConfigError: DK_MODE_ORDER: feature "pagination" (paginate) is in server mode, but "sorting" (sort) runs before it in client mode; server steps must come first
  where   feature "pagination"
  fix     1. move "sorting" to the server too: sorting({ mode: 'server' })
          2. or handle "pagination" in the client: pagination({ mode: 'client' }) (the default)
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_mode_order
```

### DK_FETCHER_WITHOUT_SERVER_MODE

`error` · config: thrown at creation · fault test: [fetcher.test.ts](../../packages/core/src/source/fetcher.test.ts)

**Problem.** `options.fetcher` is set, but no feature is in server mode: nothing would tell the fetcher what to load. The table is not created (in `setOptions()`, the call is rejected).

**Common causes.**

- Forgetting `mode: 'server'` on the features the API handles.
- Using `fetcher` to load all rows once (pass them as `data` instead).

**Fix.**

- Set `mode: 'server'` on the features the server handles, e.g. `pagination({ mode: 'server' })`.
- Or load the rows yourself and pass them as `data` (client mode).

**Example.**

```ts
import { createTable, pagination } from '@datakable/core'
import { withFetcher } from '@datakable/core/server'

createTable({
  features: [pagination()], // client mode (the default)
  fetcher: withFetcher(async () => ({ rows: [], rowCount: 0 })),
})
```

throws:

```text
DatakableConfigError: DK_FETCHER_WITHOUT_SERVER_MODE: options.fetcher is set, but no feature is in server mode
  where   options.fetcher
  fix     1. set mode: 'server' on the features the server handles (installed: pagination), e.g. pagination({ mode: 'server' })
          2. or remove fetcher and pass the rows as options.data (client mode)
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_fetcher_without_server_mode
```

### DK_FEATURE_DUPLICATE

`error` · config: thrown at creation · fault test: [feature.test.ts](../../packages/core/src/feature/feature.test.ts)

**Problem.** Two features with the same `name` are installed. A feature's name is its state slice key, so it must be unique per table; the table is not created.

**Common causes.**

- Spreading a preset that already contains the feature (`[...defaultFeatures, sorting(…)]`).
- Two plugins that picked the same name.

**Fix.**

- Install each feature once, with all its options in one call.
- Rename one of two different features that share a name (`defineFeature({ name })`).

**Example.**

```ts
import { createTable, defaultFeatures, sorting } from '@datakable/core'

createTable({
  data: [{ id: 1, name: 'Ada' }],
  // defaultFeatures already has sorting(): this adds a second one.
  features: [...defaultFeatures, sorting({ locale: 'de' })],
})
```

throws:

```text
DatakableConfigError: DK_FEATURE_DUPLICATE: feature "sorting" is installed twice (features[3] and features[5]); a feature name is its state slice key and must be unique per table
  where   feature "sorting"
  fix     1. remove features[5] (or features[3]): pass "sorting" once, with all its options in one call
          2. for two different features that share a name, rename one: defineFeature({ name: ... })
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_feature_duplicate
```

### DK_FEATURE_API_CONFLICT

`error` · config: thrown at creation · fault test: [feature.test.ts](../../packages/core/src/feature/feature.test.ts)

**Problem.** Two features expose a method with the same name, or a feature exposes a name the table already has. One of them would be unreachable, so the table is not created.

**Common causes.**

- A plugin that re-implements a built-in feature's method (`toggleSort`).
- A plugin method named like a core method (`reset`, `setState`).

**Fix.**

- Namespace the plugin's methods (`quickSortToggle()`), or install only one of the two features.
- To change what a core method does, use an interceptor instead.

**Example.**

```ts
import { createTable, defineFeature, sorting } from '@datakable/core'

// A plugin that adds its own toggleSort: sorting() already has one.
const quickSort = defineFeature({
  name: 'quickSort',
  stage: 'none',
  initialState: () => ({}),
  createApi: () => ({ toggleSort: (id: string) => void id }),
})

createTable({ data: [{ id: 1, name: 'Ada' }], features: [sorting(), quickSort] })
```

throws:

```text
DatakableConfigError: DK_FEATURE_API_CONFLICT: feature "quickSort" exposes "toggleSort", which feature "sorting" already exposes
  where   feature "quickSort"
  fix     1. namespace the method in feature "quickSort": quickSortToggleSort() or quickSort.toggleSort()
          2. or rename it in feature "sorting", or install only one of the two features
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_feature_api_conflict
```

### DK_FEATURE_INCOMPATIBLE

`error` · development only · config: thrown at creation · fault test: [versioning.test.ts](../../packages/core/src/versioning/versioning.test.ts)

**Problem.** A feature declares `requires: { core: '<range>' }` and the installed core does not satisfy it (or the range is not valid semver). The table is not created.

**Common causes.**

- A plugin built for a newer (or older) major version of core.
- A plugin with an invalid `requires.core`.

**Fix.**

- Upgrade `@datakable/core` (and `@datakable/react` / `datakable`, released together) to the required range.
- Or use a version of the plugin that supports your core.

**Example.**

```ts
import { createTable, defineFeature } from '@datakable/core'

// A plugin built for a future major version of core.
const heatmap = defineFeature({
  name: 'heatmap',
  stage: 'none',
  requires: { core: '^2.0.0' },
  initialState: () => ({}),
  createApi: () => ({}),
})

createTable({ data: [], features: [heatmap] })
```

throws:

```text
DatakableConfigError: DK_FEATURE_INCOMPATIBLE: feature "heatmap" requires @datakable/core ^2.0.0, but this is <version>
  where   feature "heatmap"
  fix     1. upgrade core: pnpm add @datakable/core@"^2.0.0" (and @datakable/react / datakable to the same version)
          2. or use a version of feature "heatmap" that supports @datakable/core <version>
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_feature_incompatible
```

### DK_CONTROLLED_WITHOUT_HANDLER

`warn` · fault test: [create-table.test.ts](../../packages/core/src/table/create-table.test.ts)

**Problem.** `options.state` controls some slices, but there is no `onStateChange`: updates to those slices are dropped, so interactions that change them (sorting, paging, …) are frozen.

**Common causes.**

- Passing `state` to restore a saved state (that is `initialState`).
- Forgetting to wire `onStateChange` when syncing state with a store or the URL.

**Fix.**

- Pass `onStateChange: (updater) => …` and feed the result back with `setOptions({ state })` (in React: `useState` + the `state` prop).
- Or use `initialState` so the table owns those slices.

**Example.**

```ts
import { createTable, sorting } from '@datakable/core'

const users = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Grace' },
]

const table = createTable({
  data: users,
  features: [sorting()],
  state: { sorting: { by: [] } }, // controlled, but nothing receives the updates
})
table.toggleSort('name')
```

prints (development console):

```text
⚠ [DataKable table#1] DK_CONTROLLED_WITHOUT_HANDLER: options.state controls "sorting" but options.onStateChange is missing
  where   options.state.sorting
  impact  interactions that change these slices are frozen (their updates are dropped)
  fix     1. pass onStateChange: (updater) => setMyState(updater), and feed the result back with setOptions({ state })
          2. or remove "sorting" from options.state (use initialState) so the table owns them
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_controlled_without_handler
  context trigger=init run=0 phase=client
```

### DK_CONTROLLED_NOT_FED_BACK

`warn` · development only · fault test: [create-table.test.ts](../../packages/core/src/table/create-table.test.ts)

**Problem.** The table asked `onStateChange` to change a controlled slice, but one second later `options.state` still holds the old value. A controlled slice shows only what you pass back, so the interaction that asked for the change (a sort, a page change, …) looks frozen. The check runs in development only, once per ignored change, and only when the value is never fed back: a re-render, store update or navigation that passes any new value (even a different one than asked) is an answer.

**Common causes.**

- An `onStateChange` that logs or stores the change somewhere the table does not read (a ref, a variable, an analytics call).
- Calling the updater but discarding its result, or setting a different state than the one passed as `state`.
- Passing a constant `state` object (to restore a saved view) where `initialState` was meant.

**Fix.**

- Apply the updater and pass the result back: `onStateChange: (updater) => setMyState(updater)` with `state={myState}` in React, or `table.setOptions({ state })` with `createTable`.
- To set only a starting value, use `initialState` so the table owns the slice.
- To reject a change on purpose, disable the control that asks for it instead.

**Example.**

```ts
import { createTable, sorting } from '@datakable/core'

const users = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Grace' },
]

const table = createTable({
  data: users,
  features: [sorting()],
  state: { sorting: { by: [] } },
  onStateChange: (updater) => {
    console.log(updater({})) // receives the change, but never passes it back in state
  },
})
table.toggleSort('name')
```

prints (development console):

```text
⚠ [DataKable table#1] DK_CONTROLLED_NOT_FED_BACK: onStateChange was called with a change to "sorting", but options.state still had the old value 1000 ms later
  where   options.state.sorting
  impact  the change was not applied: a controlled slice shows only the value you pass back, so interactions that change it look frozen
  fix     1. apply the updater and feed the result back: onStateChange: (updater) => setMyState(updater), then pass the new state as options.state (React: the state prop; createTable: table.setOptions({ state }))
          2. or move "sorting" to initialState so the table owns it
          3. if you reject the change on purpose, disable the control that asks for it instead
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_controlled_not_fed_back
  context trigger=api:toggleSort run=0 phase=client
```

### DK_UNSTABLE_COLUMNS

`warn` · `@datakable/react` · development only · fault test: [use-data-table.test.tsx](../../packages/react/src/use-data-table.test.tsx)

**Problem.** `useDataTable` received a new `columns` array with the same shape on consecutive renders. Columns are compared by reference: each new array rebuilds the column cache and re-runs the pipeline. (In a re-render caused by the table itself, the columns it already has are kept, so this never loops.)

**Common causes.**

- Columns written inline in the component body (`columns: [{ key: 'name' }]`).

**Fix.**

- Define the columns outside the component, or memoise them with `useMemo`.
- Create a new array only when the columns really change (accessor / format / cell).

**Example.**

```tsx
import { useDataTable } from '@datakable/react'

const users = [
  { id: 1, name: 'Ada', age: 36 },
  { id: 2, name: 'Grace', age: 45 },
]

export default function Users() {
  // A new columns array on every render.
  const table = useDataTable({ data: users, columns: [{ key: 'name' }, { key: 'age' }] })
  return <p>{table.rowModel.rows.length} users</p>
}
```

prints (development console):

```text
⚠ [DataKable table#1] DK_UNSTABLE_COLUMNS: useDataTable received a new columns array with the same shape on 2 renders in a row (columns are compared by reference)
  where   options.columns
  impact  each new array rebuilds the column cache and re-runs the pipeline; in a re-render caused by the table itself, the columns the table already has are kept
  fix     1. define the columns outside the component, or memoise them: useMemo(() => [...columns], [the values they read])
          2. a new columns array is how you tell the table the columns changed (accessor / format / cell), so create one only when they do
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_unstable_columns
  context trigger=init run=2 phase=client
```

### DK_UNSTABLE_OPTION

`warn` · `@datakable/react` · development only · fault test: [use-data-table.test.tsx](../../packages/react/src/use-data-table.test.tsx)

**Problem.** `useDataTable` received a new `data`, `fetcher`, `rowKey` function or feature function option (`features[0].searchFn`) reference on consecutive renders. New data is ingested again; a new fetcher does not refetch; features are read once, so a new feature function is ignored (the first one keeps running, a stale closure).

**Common causes.**

- Derived data computed in the render (`users.filter(…)`, `rows.map(…)`).
- Inline functions (`fetcher={async () => …}`, `rowKey={(r) => r.id}`).

**Fix.**

- Memoise derived data (`useMemo`), or keep it in state.
- Wrap functions in `useCallback` or define them outside the component; call `table.refetch()` when a value the fetcher reads changes.
- Create features once (`useMemo(() => [search({ searchFn })], [])` or outside the component) and read changing values through a ref.

**Example.**

```tsx
import { useDataTable } from '@datakable/react'

const users = [
  { id: 1, name: 'Ada', age: 36 },
  { id: 2, name: 'Grace', age: 17 },
]
const columns = [{ key: 'name' }, { key: 'age' }] as const

export default function Adults({ minAge = 18 }: { minAge?: number }) {
  // A new (filtered) data array on every render.
  const table = useDataTable({ data: users.filter((u) => u.age >= minAge), columns })
  return <p>{table.rowModel.rows.length} adults</p>
}
```

prints (development console):

```text
⚠ [DataKable table#1] DK_UNSTABLE_OPTION: useDataTable received a new data reference on 2 renders in a row
  where   options.data
  impact  each new array is ingested again (schema, data checks, pipeline); in a re-render caused by the table itself an array with equal rows is skipped
  fix     1. memoise derived data: useMemo(() => rows.filter(...), [rows])
          2. or keep the data in state and pass the same array until it changes
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_unstable_option
  context trigger=init run=2 phase=client
```

### DK_STATE_UNKNOWN_KEY

`warn` · fault test: [column-filters.test.ts](../../packages/core/src/features/column-filters/column-filters.test.ts)

**Problem.** A state slice (from `initialState`, `state` or `setState`) has an entry for a column that does not exist, e.g. a filter on a renamed column. The entry is ignored; the other entries still apply.

**Common causes.**

- State restored from the URL or storage that was saved before a column was renamed or removed.
- A typo in a column id.

**Fix.**

- Use an existing column id (the fix suggests the closest one).
- Drop unknown ids when parsing saved state, or add the column.

**Example.**

```ts
import { columnFilters, createTable } from '@datakable/core'

const users = [
  { id: 1, name: 'Ada', team: 'core' },
  { id: 2, name: 'Grace', team: 'compilers' },
]

// Saved before the column `group` was renamed to `team`.
const saved = JSON.parse('{"columnFilters":{"group":{"type":"equals","value":"core"}}}')

const table = createTable({ data: users, features: [columnFilters()], initialState: saved })
table.getRowModel()
```

prints (development console):

```text
⚠ [DataKable table#1] DK_STATE_UNKNOWN_KEY: state.columnFilters has an entry for "group", which is not a column
  where   options.state.columnFilters.group
  impact  the entry is ignored (the other entries still apply); it may come from an older URL or saved state, or the column was renamed or removed
  fix     1. use one of the column ids: "id", "name", "team"
          2. drop "group" when parsing initialState / state (e.g. from the URL), or add the column
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_state_unknown_key
  context trigger=init run=1 phase=client
```

## Lifecycle and SSR

### DK_TABLE_DESTROYED

`warn` · fault test: [create-table.test.ts](../../packages/core/src/table/create-table.test.ts)

**Problem.** A table method was called after `table.destroy()`. The call is ignored.

**Common causes.**

- A timer, a subscription or a late event handler that outlives the component.
- A table reused after its component unmounted.

**Fix.**

- Cancel timers and unsubscribe in your cleanup.
- Create a new table when the component mounts again.

**Example.**

```ts
import { createTable, sorting } from '@datakable/core'

const table = createTable({ data: [{ id: 1, name: 'Ada' }], features: [sorting()] })
table.destroy() // e.g. a component unmounted

table.toggleSort('name') // e.g. a timer or a late event handler
```

prints (development console):

```text
⚠ [DataKable table#1] DK_TABLE_DESTROYED: table.toggleSort() was called after table.destroy()
  where   operation table.toggleSort
  impact  the call was ignored (no-op)
  fix     1. stop calling toggleSort() after destroy(): unsubscribe / cancel timers in your cleanup
          2. create a new table with createTable() if the component is mounted again
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_table_destroyed
  context trigger=api:toggleSort run=0 phase=client
```

### DK_UPDATE_LOOP

`error` · fault test: [create-table.test.ts](../../packages/core/src/table/create-table.test.ts)

**Problem.** State updates re-entered from listeners too many rounds in a row (50). The update is dropped to break the loop; the state is unchanged by it.

**Common causes.**

- A `subscribe` listener (or an `onStateChange` round trip) that changes the state on every notification.

**Fix.**

- Update state only when the value differs (compare before calling a setter).
- Derive the value instead of storing it, or move the update out of the listener.

**Example.**

```ts
import { createTable, sorting } from '@datakable/core'

const users = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Grace' },
]
const table = createTable({ data: users, features: [sorting()] })

// A listener that changes the state on every notification: each change notifies it again.
table.subscribe(() => table.toggleSort('name'))
table.toggleSort('name')
```

prints (development console):

```text
✖ [DataKable table#1] DK_UPDATE_LOOP: state updates re-entered from listeners 50 rounds in a row (last update: "sorting")
  where   operation table.setState at listener #1
  impact  the update was dropped to break the loop; the state is unchanged by it
  fix     1. make listener #1 update state only when the value differs (compare before calling setState)
          2. derive the value instead of storing it, or move the update out of the listener
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_update_loop
  context trigger=api:toggleSort run=50 phase=client
```

### DK_HYDRATION_MISMATCH

`warn` · emitted by `@datakable/react` · fault test: [hydrate.test.tsx](../../packages/react/src/hydrate.test.tsx)

**Problem.** The table changed between the server render and React's hydration commit: the named state slices (or `rows`, when the data or columns differ) are not what the server rendered. React hydrated with the server snapshot and re-renders with the live one at once, so the server HTML is replaced (a visible flash).

**Common causes.**

- Client-only state applied while rendering (from `localStorage`, `window` size, a client-only URL parse).
- Different `initialState` / `data` / `initialData` on the server and the client.

**Fix.**

- Give the server and the client the same initial state and data (e.g. parse both from the request URL).
- Apply client-only changes after mount, in `useEffect`.

**Example.**

Needs a server render, then a hydration that differs from it; the injecting test is [hydrate.test.tsx](../../packages/react/src/hydrate.test.tsx). Built from its details:

```text
⚠ [DataKable table#1] DK_HYDRATION_MISMATCH: the table changed while React hydrated it: "sorting" differ from the server snapshot
  where   operation hydrate at sorting
  impact  React hydrated with the server snapshot and re-renders with the live one at once: the server HTML is replaced (a visible flash)
  fix     1. give the server and the client the same initial "sorting" (initialState / state / data / initialData), e.g. parse them from the same URL
          2. apply client-only changes (localStorage, window size, …) after mount, in useEffect, not while rendering
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_hydration_mismatch
  context trigger=hydrate run=1 phase=hydrate
```

### DK_SSR_ASYNC_DEFERRED

`info` · fault test: [ssr.test.ts](../../packages/core/src/table/ssr.test.ts)

**Problem.** Information: async work (the `fetcher`, or a `searchFn` for an initial query) does not run during a server render; it starts on the client after hydration. The server HTML has `status: 'pending'` (`<DataTable />` renders its Loading state).

**Common causes.**

- Server rendering a table with a `fetcher` and no `initialData`.

**Fix.**

- Fetch on the server and pass the result as `initialData` (with `rowCount` for server pagination): the HTML has the rows, and hydration does not fetch again.
- Or accept the client-side loading state.

**Example.**

```tsx
import { type FetchParams, type FetchResult, pagination } from '@datakable/core'
import { withFetcher } from '@datakable/core/server'
import { DataTable } from '@datakable/react'
import { renderToString } from 'react-dom/server'

type User = { id: number; name: string }

async function fetchUsers({ pageIndex, signal }: FetchParams): Promise<FetchResult<User>> {
  const res = await fetch(`/api/users?page=${pageIndex}`, { signal })
  return res.json()
}
const features = [pagination({ mode: 'server' })]

function Users() {
  // No initialData: the server has no rows to render.
  return <DataTable rowKey="id" features={features} fetcher={withFetcher(fetchUsers)} />
}

// In the server render (Next.js, Remix, a Node server, …).
renderToString(<Users />)
```

prints (development console):

```text
ℹ [DataKable table#1] DK_SSR_ASYNC_DEFERRED: the fetcher did not run during the server render (async work is deferred to the client)
  where   options.fetcher
  impact  the server HTML has status 'pending' and no fetched rows; the fetch starts after hydration
  fix     1. fetch on the server and pass the result as initialData (with rowCount for server pagination): the HTML then has the rows, and hydration does not re-fetch
          2. or keep it: the client shows its loading state until the first fetch applies
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_ssr_async_deferred
  context trigger=init run=0 phase=ssr
```

### DK_RENDER_FAILED

`error` · `@datakable/react` · fault test: [data-table.fault.test.tsx](../../packages/react/src/data-table.fault.test.tsx)

**Problem.** A React component rendered by the table threw. Inside a cell (a component returned by `cell` / `invalidCell`), only that cell renders `⚠` and everything else keeps working; outside the cells (a `components.Empty` / `Loading` / `Error` part), the body shows the Error state; a `components.SearchInput` / `Pagination` part is replaced by the default one (`slot: 'components.SearchInput'`). (A throw in the `cell` function itself is [`DK_CALLBACK_FAILED`](#dk_callback_failed).)

**Common causes.**

- A cell component that does not handle missing or unexpected values.
- A custom state component that throws.

**Fix.**

- Make the component total: guard `null` / `undefined` / unexpected values. The error is `context.cause` in `onDiagnostic`.
- For your own fallback instead of `⚠`, wrap the component in an error boundary inside `cell`.

**Example.**

```tsx
import { DataTable } from '@datakable/react'

type User = { id: number; name: string; avatar?: { url: string } }
const users: User[] = [
  { id: 1, name: 'Ada', avatar: { url: '/ada.png' } },
  { id: 2, name: 'Grace' }, // no avatar
]

function Avatar({ user }: { user: User }) {
  const { url } = user.avatar as { url: string } // throws for Grace
  return <img src={url} alt="" />
}

export default function Users() {
  return (
    <DataTable
      data={users}
      rowKey="id"
      columns={[{ key: 'id' }, { key: 'name', cell: ({ row }) => <Avatar user={row} /> }]}
    />
  )
}
```

prints (development console):

```text
✖ [DataKable table#1] DK_RENDER_FAILED: a component returned by columns[1].cell (column "name") threw TypeError while rendering row #1
  where   operation render:cell at columns[1].cell
  impact  that cell renders ⚠; the other cells and rows, the header, search, pagination and the table API keep working, and the cell renders again when its row's data or the columns change
  fix     1. find the throwing component in context.cause (passed to onDiagnostic) and make it total: guard null / undefined / unexpected values of column "name" instead of throwing
          2. for your own fallback instead of ⚠, wrap the component in an error boundary inside columns[1].cell
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_render_failed
  context trigger=init run=1 phase=client
```

## Versions

### DK_DEPRECATED

`warn` · fault test: [versioning.test.ts](../../packages/core/src/versioning/versioning.test.ts)

**Problem.** A deprecated API was used. It still works in this version and is removed in the version named; reported once per API per session (across every copy of core). DataKable deprecates for at least one minor version before removing.

**Common causes.**

- Code written for an older version, or a plugin that calls a deprecated API.

**Fix.**

- Use the replacement the diagnostic names; run the codemod when there is one.

**Example.**

```ts
import { defineDeprecation, warnDeprecated } from '@datakable/core'

// A plugin deprecates one of its methods (DataKable's own deprecations work the same way).
const oldExport = defineDeprecation({
  api: 'table.exportCsv',
  since: '1.4.0',
  removeIn: '2.0.0',
  replacement: 'table.export({ format: "csv" })',
})

export function exportCsv() {
  warnDeprecated(oldExport) // once per session
}
exportCsv()
```

prints (development console):

```text
⚠ [DataKable datakable] DK_DEPRECATED: table.exportCsv is deprecated since 1.4.0
  where   operation table.exportCsv
  impact  it still works in this version and is removed in 2.0.0; this warning is shown once per session
  fix     1. use table.export({ format: "csv" }) instead
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_deprecated
  context trigger=init run=0 phase=client
```

### DK_DUPLICATE_CORE

`error` · development only · fault test: [versioning.test.ts](../../packages/core/src/versioning/versioning.test.ts)

**Problem.** Two copies of `@datakable/core` of different versions are loaded in one page (detected through a global registry). Each table works with its own copy, but plugins built against the other copy may be ignored or fail registry checks, and the bundle ships core twice. Copies of one version (ESM and CJS builds, a Next.js dev server's layers, a hot reload) are not this error: they report [`DK_DUPLICATE_CORE_SAME_VERSION`](#dk_duplicate_core_same_version), an info.

**Common causes.**

- Two versions of `@datakable/core` in `node_modules` (a plugin that pins another version).
- `@datakable/react` / `datakable` at a different version than `@datakable/core`.

**Fix.**

- Find the second copy: `pnpm why @datakable/core` (`npm ls`, `yarn why`).
- Dedupe it, align the release group to one version, or force one version with `overrides` / `resolutions`.

**Example.**

Needs two copies of core in one bundle (the test loads core twice). Built from its details:

```text
✖ [DataKable table#1] DK_DUPLICATE_CORE: 2 copies of @datakable/core are loaded (1.2.0, 1.3.1); features, interceptors and types from one copy do not match the other
  where   operation createTable
  impact  each table works with its own copy, but plugins built against the other copy may be ignored or fail instanceof / registry checks, and the bundle ships core twice
  fix     1. find who pulls the second copy: pnpm why @datakable/core (npm ls @datakable/core / yarn why)
          2. dedupe it: pnpm dedupe (npm dedupe), and align @datakable/react and datakable to one version
          3. or force one version: "pnpm": { "overrides": { "@datakable/core": "<version>" } } in package.json (npm "overrides", yarn "resolutions")
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_duplicate_core
  context trigger=init run=0 phase=client
```

### DK_DUPLICATE_CORE_SAME_VERSION

`info` · development only · once per session · fault test: [versioning.test.ts](../../packages/core/src/versioning/versioning.test.ts)

**Problem.** `@datakable/core` of one version was evaluated more than once in one process. Tables work, each with its own copy, and `strict: true` does not throw it. Two things differ between the copies: a `DatakableError` from one is not an `instanceof` the other's classes, and a browser bundle that holds both ships core twice.

**Common causes.**

- Node code that both `import`s and `require`s `@datakable/core`: the ESM and the CJS build each load.
- A Next.js dev server: the RSC, SSR and route-handler layers each load core.
- A dev server's hot reload that re-runs core.
- Two installs of the same version (a package manager that could not dedupe them).

**Fix.**

- Compare errors by their `.code` (`err.code === 'DK_INVALID_OPTION'`), not `instanceof`.
- In one Node process, load `@datakable/core` one way: `import` or `require`.
- In a browser bundle, find the second install: `pnpm why @datakable/core`, then `pnpm dedupe`.

**Example.**

Needs core evaluated twice in one process (the test loads it three times). Built from its details:

```text
ℹ [DataKable table#1] DK_DUPLICATE_CORE_SAME_VERSION: @datakable/core 1.2.0 is loaded 2 times, all this version: its ESM and CJS builds, a bundler's layers (Next.js dev: RSC, SSR, route handlers), a hot reload, or two installs of it
  where   operation createTable
  impact  tables work, each with its own copy; a DatakableError thrown by one copy is not an instanceof the classes of the other, and a browser bundle with both ships core twice
  fix     1. compare errors by their .code (e.g. err.code === "DK_INVALID_OPTION"), not instanceof
          2. mixed import and require of @datakable/core in one Node process: use one of them
          3. in a browser bundle, find the second install: pnpm why @datakable/core, then pnpm dedupe
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_duplicate_core_same_version
  context trigger=init run=0 phase=client
```

### DK_VERSION_MISMATCH

`warn` · development only · fault test: [versioning.test.ts](../../packages/core/src/versioning/versioning.test.ts)

**Problem.** `@datakable/core`, `@datakable/react` and `datakable` are released together with one version, and the installed ones differ. It may work, but APIs and types between them can disagree.

**Common causes.**

- Upgrading one package of the group without the others.

**Fix.**

- Install the same version of every package of the group you use (the fix gives the command).

**Example.**

Needs two installed versions of the release group. Built from its details:

```text
⚠ [DataKable table#1] DK_VERSION_MISMATCH: @datakable/react@1.3.0 is used with @datakable/core@1.2.0; these packages are released together and must have the same version
  where   operation createTable
  impact  it may work, but APIs and types between the two can disagree
  fix     1. pnpm add @datakable/core@1.3.0 @datakable/react@1.3.0 datakable@1.3.0 (install only the ones you use)
          2. or with npm: npm install @datakable/core@1.3.0 @datakable/react@1.3.0 datakable@1.3.0
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_version_mismatch
  context trigger=init run=0 phase=client
```

### DK_DEP_INCOMPATIBLE

`warn` · fault test: [versioning.test.ts](../../packages/core/src/versioning/versioning.test.ts)

**Problem.** A dependency (`exsorted`, `ex-search`, `kk-debounce`) lacks a capability DataKable uses, probably because it was overridden to a version outside the supported range. The feature uses a correct fallback instead (native sort, substring matching, …).

**Common causes.**

- An `overrides` / `resolutions` entry that forces another version of the dependency.

**Fix.**

- Install a supported version, or remove the override.

**Example.**

Needs the dependency overridden at install time. Built from its details:

```text
⚠ [DataKable table#1] DK_DEP_INCOMPATIBLE: exsorted has no usable timSort / radixSort / countingSort; it was probably overridden to a version outside ^1.2.3
  where   feature "sorting"
  impact  feature "sorting" uses Array.prototype.sort (native, stable) instead; results stay correct
  fix     1. install a supported version: pnpm add exsorted@"^1.2.3" (check pnpm why exsorted)
          2. remove the override / resolution of exsorted from package.json
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_dep_incompatible
  context trigger=api:toggleSort run=1 phase=client
```

## Environment and performance

### DK_ENV_FALLBACK

`info` · fault test: [env.test.ts](../../packages/core/src/pipeline/env.test.ts)

**Problem.** Information: a runtime capability is missing (an `Intl.Collator` locale for sorting, or `scheduler.yield` for time-sliced work) and DataKable uses a fallback; results are the same.

**Common causes.**

- A locale the runtime's ICU data does not have (small-ICU builds, some browsers).
- An older runtime without the newer API.

**Fix.**

- For a locale: use one the runtime supports, or ship full ICU data / an `Intl` polyfill.
- For `scheduler.yield`: nothing to do; `setTimeout` is used instead, and the native API where the runtime has it.

**Example.**

```ts
import { createTable, sorting } from '@datakable/core'

const users = [
  { id: 1, name: 'Ångström' },
  { id: 2, name: 'Zed' },
]

// 'xx' is a well-formed locale tag that no ICU build has.
const table = createTable({ data: users, features: [sorting({ locale: 'xx' })] })
table.toggleSort('name')
table.getRowModel()
```

prints (development console):

```text
ℹ [DataKable table#1] DK_ENV_FALLBACK: Intl.Collator ("xx") is not available in this environment (feature "sorting")
  where   feature "sorting"
  impact  DataKable uses the runtime's collation for "en-US" instead; results are the same
  fix     1. use a locale this runtime supports (Intl.Collator.supportedLocalesOf("xx") is empty)
          2. or ship full ICU data (Node: the default full-icu build; browsers: a polyfill such as @formatjs/intl)
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_env_fallback
  context trigger=api:toggleSort run=1 phase=client
```

### DK_PERF_HINT

`info` · fault test: [env.test.ts](../../packages/core/src/pipeline/env.test.ts)

**Problem.** Information from the tracer: a pipeline step took longer than one task's budget (50 ms), so the page could not respond to input while it ran. Reported with the step, the time and the row count.

**Common causes.**

- A large client-mode table with an expensive step (a custom filter, regex or `Intl` per row).

**Fix.**

- Let the server do it: `<feature>({ mode: 'server' })` with a `fetcher`.
- Make the per-row work cheaper (precompute keys), or run it in a Worker.

**Example.**

```ts
import { createTable, defineFeature } from '@datakable/core'

// A filter step that blocks the main thread for ~60 ms (over the 50 ms budget of one task).
const slowFilter = defineFeature({
  name: 'slowFilter',
  stage: 'filter',
  initialState: () => ({}),
  createApi: () => ({}),
  rowModel: (indices) => {
    const end = performance.now() + 60
    while (performance.now() < end) {
      // e.g. a regex or Intl call per row on a large table
    }
    return indices
  },
})

createTable({ data: [{ id: 1 }, { id: 2 }], features: [slowFilter] }).getRowModel()
```

prints (development console):

```text
ℹ [DataKable table#1] DK_PERF_HINT: the "slowFilter" step took 60.0 ms on 2 rows, over the 50.0 ms budget of one task
  where   feature "slowFilter"
  impact  the page could not respond to input while it ran (a long task)
  fix     1. let the server do it: slowFilter({ mode: 'server' }) with options.fetcher
          2. make the per-row work of "slowFilter" cheaper (precompute keys, avoid Intl / regex per row), or run it in a Worker
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_perf_hint
  context trigger=init run=1 phase=client
```

## Redaction

### DK_UNSAFE_REDACTION

`warn` · production only · fault test: [redact.test.ts](../../packages/core/src/diagnostics/redact.test.ts)

**Problem.** `diagnostics: { redact: 'full' }` in a production build: raw row keys and cell values (except `sensitive` columns) reach `onDiagnostic`, `getDiagnostics()` and the console. The setting is still applied.

**Common causes.**

- A debugging setting left in production code.

**Fix.**

- Remove `redact` in production (the default is `'safe'`), or use `'keys'`.
- Mark personal-data columns `sensitive: true` so they are never logged.

**Example.**

Emitted only by a production build, which prints no text; this is the text `datakable/messages` adds. Built from its details:

```text
⚠ [DataKable table#1] DK_UNSAFE_REDACTION: diagnostics.redact is 'full' in a production build
  where   options.diagnostics.redact
  impact  raw row keys and cell values (except sensitive columns) reach onDiagnostic, getDiagnostics() and the console
  fix     1. remove diagnostics.redact in production (the default is 'safe')
          2. or use 'keys' to log raw row keys without cell values
          3. mark personal-data columns with sensitive: true so they are never logged
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_unsafe_redaction
  context trigger=init run=0 phase=client
```

## Catch-all

### DK_INTERNAL

`error` · fault test: [boundary.test.ts](../../packages/core/src/intercept/boundary.test.ts)

**Problem.** An error was thrown from DataKable's own code: likely a DataKable bug (or a plugin wired incorrectly). The operation's fallback is applied and the table keeps working. The fix carries a prefilled GitHub issue link (version, operation, slot, error name; never values). The classifier reads the top stack frame: when DataKable is inlined into an app bundle (or a shared Vite chunk) its frames cannot be attributed, so a bundled production build reports these as [`DK_UNKNOWN`](#dk_unknown). The error message is redacted as a value (`string(N)` under `'safe'` / `'keys'`).

**Common causes.**

- A bug in DataKable.
- A plugin calling internal APIs in an unsupported way.

**Fix.**

- Report it with the link, attaching `diagnostic.toJSON()` and `table.explain()` (both redacted).
- Meanwhile, check plugins and interceptors registered on the operation.

**Example.**

A bug in DataKable cannot be produced on purpose (the test injects a throw from core code). Built from its details:

```text
✖ [DataKable table#1] DK_INTERNAL: TypeError thrown inside DataKable code during state:dispatch (message: string(50)) — likely a DataKable bug
  where   operation state:dispatch at setState
  impact  the update was dropped (state unchanged); the table keeps working
  fix     1. this is likely a DataKable bug or a plugin wiring error — report it: https://github.com/Ink01101011/datakable/issues/new?title=DK_INTERNAL%20in%20state%3Adispatch%20(TypeError)&body=package%3A%20%40datakable%2Fcore%40<version>%0Aoperation%3A%20state%3Adispatch%0Aslot%3A%20setState%0Aerror%3A%20TypeError%0A%0Adiagnostic.toJSON()%3A%0A%0Atable.explain()%3A%0A
          2. attach diagnostic.toJSON() and table.explain() (both redacted) to the issue
          3. meanwhile, check plugins / interceptors registered on this operation
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_internal
  context trigger=api:toggleSort run=3 phase=client
```

### DK_UNKNOWN

`error` · fault test: [boundary.test.ts](../../packages/core/src/intercept/boundary.test.ts)

**Problem.** Something was thrown that DataKable could not classify: not a user callback it called (that is `DK_CALLBACK_FAILED`) and not from its own code (`DK_INTERNAL`), e.g. a throwing getter or Proxy in your data, or a non-Error value. The operation's fallback is applied and the table keeps working. In bundled production builds, DataKable's own errors are reported here too (see `DK_INTERNAL`).

**Common causes.**

- Getters, Proxies or class instances in the data that throw when read.
- Third-party code running inside an operation.

**Fix.**

- Inspect `context.cause` in `onDiagnostic` for the error and its stack.
- Catch errors in your code that runs inside the operation; report a stack that points into DataKable as a bug.

**Example.**

Which class an error gets depends on its stack paths, so no snippet produces it reliably. Built from its details:

```text
✖ [DataKable table#1] DK_UNKNOWN: TypeError was thrown during pipeline:step at features.sorting from code DataKable could not classify
  where   operation pipeline:step at features.sorting
  impact  the step passed its input through; the table keeps working
  fix     1. inspect context.cause (passed to onDiagnostic) for the original error and its stack
          2. if your code runs inside pipeline:step (a callback, interceptor or plugin), catch errors there and return a fallback
          3. if the stack points into DataKable, report it as a bug
  docs    https://github.com/Ink01101011/datakable/blob/main/docs/errors.md#dk_unknown
  context trigger=api:toggleSort run=2 phase=client
```
