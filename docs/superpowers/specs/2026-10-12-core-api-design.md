# DataKable Core API — Design Spec (Spec 1 of 2)

- **Date:** 2026-10-12
- **Status:** Draft, awaiting user review
- **Scope:** `@datakable/core` + `@datakable/react` + `datakable`. This covers the column model, data ingest, the row pipeline (filter / validity / search / sort / paginate), data modes, diagnostics and the interceptor architecture.
- **Out of scope here:** row/cell selection (Ctrl/Cmd+click, Shift+click range). That is **Spec 2**, and it ships as a feature on top of this spec's feature contract.
- **Task breakdown:** [`docs/superpowers/plans/2026-10-12-core-api-tasks.md`](../plans/2026-10-12-core-api-tasks.md)

---

## 1. Design principles

In priority order. When two of them conflict, the higher one wins.

1. **Developer resolution first.** Every problem the system detects must tell the developer what happened in this specific case, where it happened (column, option or row), what the system did instead, and a concrete fix computed from the real data. When nothing is wrong and the developer is still puzzled, `explain()` / `explainRow()` must be able to answer "why".
2. **No silent failure.** Every error path ends in a diagnostic and a defined fallback. The table stays usable on the last good snapshot. Only `strict: true` or `invalidRows: 'throw'` make the system throw on data problems.
3. **Type safety is the product.** Wrong keys, wrong filter kinds and unrenderable columns are compile errors whenever the row type is known.
4. **Pay only for what you use.** CPU, memory and bundle bytes are the end user's cost, often on low-end devices. Hot paths carry no per-cell abstraction cost. Dev-only machinery is stripped in production.
5. **Headless core, reusable mechanisms.** Cross-cutting behaviour (errors, logging, redaction, tracing, async control, validation, deprecation) is built once on one interceptor mechanism plus declarative catalogs. No point-by-point fixes.

---

## 2. v1 scope

| In v1 (this spec) | Spec 2 | Later (v2+) |
|---|---|---|
| Column model (nested paths, derived columns, custom cells) | Row selection, cell selection, Ctrl/Cmd+click toggle, Shift+click range | Devtools panel UI |
| Column filters, validity filter, global search, sorting, pagination | | Message localisation |
| Data modes: client / server per feature, SSR | | Hybrid (simultaneous client + server) search |
| Standard Schema validation, `invalidRows` | | Virtualisation (TanStack Virtual considered) |
| Diagnostics, redaction, `explain` / `explainRow`, versioning / deprecation | | |
| Interceptor architecture + catalogs | | |
| React `useDataTable` + zero-config `<DataTable />` | | |

**Libraries:** the user's own `exsorted` (sorting), `ex-search` (fuzzy search) and `kk-debounce` (typing timing). TanStack is not used in v1, and is reconsidered for virtualisation.

---

## 3. Architecture

### 3.1 Packages and modules

```
@datakable/core          (framework-agnostic, zero React)
├─ table/          createTable(): store — getState / setState / subscribe / destroy, controlled state
├─ feature/        defineFeature(), HKT-lite types (FeatureTypes / Apply / StateOf / ApiOf), stage ordering
├─ intercept/      operation registry, defineInterceptor(), chain compiler, ctx pool
├─ catalog/        defineDiagnostic(), defineOptions(), defineDeprecation(), defineSlot()
├─ column/         ColumnDef<T,R>, Path<T>, PathValue, FilterFor, getValue(), default formatter
├─ ingest/         rowKey, schema validation, data checks, zero-config column derivation
├─ pipeline/       index-based runner, per-step memo, column cache, Row class (visible rows only)
├─ features/       columnFilters · validity · search · sorting · pagination   (one entry each)
├─ source/         client | server source, fetcher, async control
├─ diagnostics/    emit chain, redaction, sinks, ring buffer, explain / explainRow, version registry
└─ messages/       full human-readable problem/fix text (dev; opt-in in prod)

@datakable/react         useDataTable, <DataTable />, error boundary, optional styles.css
datakable                re-exports react + default preset; datakable/core → core
```

### 3.2 Store

- `createTable(options)` returns a store with `getState()`, `setState(updater)`, `subscribe(listener)`, `getRowModel()`, `destroy()`, the merged feature APIs, `explain()`, `explainRow(key)`, `getDiagnostics()` and `getInvalidRows()`.
- **Controlled state, per slice:** `options.state` holds any subset of slices, and `options.onStateChange(updater)` receives the changes. A slice not passed in is owned by the store.
- Snapshots are immutable. A new snapshot is created only when state or the row model changes.
- Listeners are isolated: one throwing listener does not prevent the others from running (`DK_LISTENER_FAILED`).
- Re-entrant `setState` from inside a listener is depth-limited (`DK_UPDATE_LOOP`).
- After `destroy()`, API calls are no-ops that emit `DK_TABLE_DESTROYED`.

### 3.3 Feature contract (plugin system)

Built-in features use exactly the same contract as third-party features.

```ts
defineFeature({
  name: 'sorting',                         // state slice key; must be unique per table
  stage: 'filter' | 'search' | 'sort' | 'paginate' | 'none',
  options: defineOptions({...}),           // validated by the generic option validator
  initialState: () => ({...}),
  createApi: (ctx) => ({...}),             // merged into the table; name clashes → DK_FEATURE_API_CONFLICT (names both, suggests a namespace)
  rowModel?: (indices, state, ctx) => indices,   // pure; operates on Uint32Array of row indices
  interceptors?: Interceptor[],            // features may contribute interceptors
  requires?: { core: '^1.0' },             // DK_FEATURE_INCOMPATIBLE if unmet
})
```

**Types (proven in prototype).** Each feature carries type-lambdas over the row type `T` through an interface that extends `FeatureTypes` with `state` / `api` written in terms of `this['T']`. `StateOf<Features, T>` and `ApiOf<Features, T>` intersect only the features that are installed:

- the API of an uninstalled feature is absent, which makes calling it a compile error;
- the `state.<slice>` of an uninstalled feature is absent too;
- API parameters are typed against `T`, so `toggleSort('nope')` is a compile error.

Constraint: state and API shapes must be hoisted generic types. Using `this` inside a nested object literal is TS2526.

**Pipeline order** (fixed by `stage`): `ingest → filter (columnFilters, validity) → search → sort → paginate`. Filter runs before search because fuzzy search is the most expensive step. The resulting set is the same in either order. Each step is memoised on (input indices reference, its own state slice).

**Default preset:** `defaultFeatures = [columnFilters(), validity(), search(), sorting(), pagination()]`. Passing `features` replaces the preset entirely.

### 3.4 Interceptor architecture

Every unit of work is an **operation** with a declared contract and fallback. Cross-cutting behaviour is implemented as interceptors over operations, never inline at call sites.

**Operation registry**

| Operation | Kind | Frequency | Fallback on failure |
|---|---|---|---|
| `table:init`, `table:setOptions`, `table:destroy` | sync | cold | config errors throw `DatakableConfigError`; others keep the previous options |
| `state:dispatch` | sync | cold | state unchanged |
| `data:ingest` | sync / async | cold | previous data kept |
| `pipeline:run` | sync | cold | last good row model |
| `pipeline:step` | sync | cold | step passes its input through |
| `column:batch` | sync | **hot** | per failed cell: `''` (format) / `undefined` (accessor) / row treated as non-matching (filter fn) |
| `async:request` | async | cold | previous results kept; `status: 'error'` |
| `diagnostic:emit` | sync | cold | swallowed + one `console.error` (the logger never kills the table) |
| `render:table`, `render:cell` (react) | sync | per render | `⚠` cell / error state |

The `render:*` ops are registered by `@datakable/react`, not core (core's registry holds only the ops above them). They are React error boundaries (`DK_RENDER_FAILED`, per-cell `⚠` via `DK_CALLBACK_FAILED`), not per-cell interceptor chains. There is no cell-level interceptor: `column:batch` covers every cell-level use case.

**Interceptor contract**

```ts
defineInterceptor({
  name: 'timing',
  on: ['pipeline:step'],                    // or '*'
  hot?: false,                              // must be true to attach to a hot op
  intercept(ctx, next) { ...; return next() },
})
```

- The type of `next()` follows the operation kind: it returns a `Promise` for async ops. An interceptor on a sync op that returns a `Promise` is a compile error, and so is one returning the wrong output type (prototype-verified).
- `ctx = { op, input, where, table, run, trigger, phase, meta, emit(), signal? }`, which is the same context that diagnostics carry.
- Chains are **compiled once** per operation at init or when the interceptor list changes. Ctx objects for hot ops are pooled and reused.
- **Hot ops are intercepted per batch, never per cell.** `column:batch` runs once per column per pipeline run. Inside it, a plain loop with an inline `try/catch` records failures as numeric (column, row) pairs. `where` strings and messages are built only when a failure occurs.
- Order and safety:
  - `errorBoundary` is always the outermost interceptor and cannot be removed; its sinks are configurable.
  - An interceptor that throws emits `DK_INTERCEPTOR_FAILED` and is skipped (its `next` is called directly).
  - Attaching to a hot op without `hot: true` triggers a dev warning that states the measured cost.

**Built-in interceptors** (they use the public API)

| Interceptor | On | Responsibility |
|---|---|---|
| `errorBoundary` | `*` | catch → classify → emit → registry fallback |
| `slotContract` | `column:batch` | checks callback return values against `defineSlot` (`DK_CALLBACK_BAD_RETURN`) |
| `asyncControl` | `async:request` | AbortController per request, latest-wins, timeout, superseded handling |
| `tracer` | `pipeline:*`, `state:dispatch` | timings and per-step counts for `explain()`; off in prod unless `trace: true` |
| `optionValidator` | `table:init`, `table:setOptions` | reads `defineOptions`: unknown / invalid / no-effect options, mode ordering, version and feature compatibility |
| `deprecation` | `table:*`, `state:dispatch` | reads `defineDeprecation` |
| `devChecks` (dev only) | `data:ingest`, `pipeline:step` | data mutation, comparator sanity, feature output and mutation checks |
| `enrich → redact → dedupe/rateLimit → sinks` | `diagnostic:emit` | the log pipeline |

**User and feature interceptors.** `createTable({ interceptors: [...] })` lets users and features hook the same operations. Intended uses: URL state sync (`state:dispatch`), analytics and audit (`state:dispatch`), performance monitoring (`pipeline:run`), company redaction rules (`diagnostic:emit`), and selection pruning on data change (Spec 2, `data:ingest`).

### 3.5 Declarative catalogs

There is a single source of truth for each concern. Mechanisms read the catalogs, and tests and docs are generated or checked from them.

- `defineDiagnostic({ code, level, problem(ctx), impact(ctx), fix(ctx), docs })` — every diagnostic code (§8.3).
- `defineOptions(schema)` — the options of each feature and of the table.
- `defineDeprecation({ api, since, removeIn, replacement, codemod? })`.
- `defineSlot({ name: 'format', returns: 'string' })` — the callback return contracts.

---

## 4. Column model and types

### 4.1 `ColumnDef<T, R>`

`columns` is an array whose elements are typed as a **distributive union** over the paths of `T`. This gives every column contextual typing of its own value type without needing a helper.

```ts
useDataTable({
  data: users,                // T inferred (or from schema, §5.1)
  rowKey: 'id',               // Path<T> or (row: T) => string | number
  columns: [
    { key: 'name', search: 1 },
    { key: 'age', filter: { type: 'range' } },
    { key: 'address.city', search: 0.5 },
    { key: 'address', cell: ({ value }) => <City c={value} /> },
    { id: 'full', accessor: (u) => `${u.first} ${u.last}` },
  ],
})
```

- **`key: Path<T>`** is a dot-path, capped at depth 4. Arrays, functions and `Date` are leaves and are not traversed. Nullable intermediate values are allowed (`manager.name` where `manager` may be `null`).
- **`PathValue<T, P>`** is the value type at that path, and is used for `filter`, `cell`, `format` and `sortFn`.
- **Unrenderable values must declare rendering.** If the value is an object, a function or an array of objects, `cell` or `format` is required (a compile error otherwise). Primitives, `Date`, arrays of primitives, `unknown` and `any` need neither; the default formatter handles them at runtime.
- **`cell` returns a generic `R`.** Core uses `R = unknown`; `@datakable/react` binds `R = ReactNode`. Core never imports React.
- **Derived columns:** `{ id, accessor: (row: T) => unknown }`, where `row` is contextually typed.
- **Other column fields:** `header`, `search?: number` (weight), `sortable?`, `sortFn?: (a: V, b: V) => number`, `sortBy?: (row: T) => primitive`, `sortAlgorithm?`, `filter?: FilterFor<V>`, `sensitive?: boolean`, `invalidCell?`.
- **Zero-config:** when `columns` is omitted, columns are derived from the union of keys over the first N rows (default 50). Function-valued keys are skipped.

**Prototype evidence (tsc 6.0.3, strict):**

- 11 valid cases compile, including nested `address.geo.lat`, nullable `manager.name`, `Date`, and derived columns with `u` inferred.
- 6 invalid cases error: typo key, nested typo, range on string, object or function column without cell/format, bad `rowKey`.
- 2 mutation checks confirm the assertions are not vacuous.
- Check time 0.26 s, 29,838 instantiations.

### 4.2 Loose types

| Row type | Behaviour |
|---|---|
| Fully typed `T` | full checking |
| Field typed `any` / `unknown` inside `T` | that field needs no `cell`; all other keys are still checked |
| Whole row `any` | detected via `IsAny<T>` and treated as `Record<string, unknown>`. Usable, but filters are limited to type-agnostic kinds (`equals`, `contains`) |
| Recommended for full safety | `schema` (§5.1) or an explicit `useDataTable<User>(...)` |

Measured problem this fixes: with plain `any[]`, `Path<any>` resolves to `string`, so `{ key: 'whatever.deep', filter: { type: 'range' } }` compiled silently.

### 4.3 Runtime value handling (always on, because runtime JSON ignores types)

- **`getValue(row, path)`** walks the path defensively. A `null` or non-object part-way through yields `undefined`. It never throws; getter/Proxy throws are caught and reported as `DK_CALLBACK_FAILED` with a column + row `where`.
- **Default formatter:**
  - `null` / `undefined` → `''`
  - primitives → `String(v)`
  - valid `Date` → `toLocaleString()`
  - array of primitives → `join(', ')`
  - object / function → `''` plus `DK_UNRENDERABLE_VALUE`
- **Compile-time error readability.** TypeScript cannot be made to show a custom message here (two prototype attempts both reported `Property 'format' is missing`). Mitigations:
  - JSDoc on `cell` / `format` explaining the rule;
  - a "Reading type errors" docs section covering the six common errors;
  - type tests that pin the key error messages, so a TypeScript upgrade that changes them is noticed.

---

## 5. Data ingest

### 5.1 Schema (Standard Schema v1)

- `schema` accepts any Standard Schema implementation (zod, valibot, arktype). The interface is copied into core, so there is no runtime dependency.
- `T` is inferred from `InferOutput<schema>`.
- Validation runs per data reference (memoised). An async schema sets `status: 'validating'`.
- **`invalidRows`**

| Mode | Invalid rows | Row type |
|---|---|---|
| `'drop'` (default) | removed from the table | `Row<T>` |
| `'flag'` | kept in the table | `Row<T>` becomes a union: `{ valid: true; original: T } \| { valid: false; original: unknown; issues }`. `cell` must narrow on `valid`; `invalidCell` renders broken cells |
| `'throw'` | throws `DatakableSchemaError` | — |

- `getInvalidRows()` → `{ index, raw: unknown, issues }[]` is available in every `invalidRows` mode.
- `invalidRows: 'flag'` without `schema` has no effect → `DK_OPTION_NO_EFFECT`.

- **Flag surfacing:**
  - `row.valid`, `row.issues`, and `row.getCellIssues(columnId)` (schema issue paths matched to column keys);
  - `<DataTable />` sets `data-invalid` + `aria-invalid` on rows and cells, puts the redacted issue in `title`, and shows a `⚠` marker;
  - default `invalidCell`: the raw value through the default formatter, with a `⚠` marker;
  - the `validity` feature filters `'all' | 'valid' | 'invalid'`.
- A schema that throws (instead of returning issues) emits `DK_SCHEMA_CRASHED`. Rows are then treated per `invalidRows` with a synthetic issue.

### 5.2 Row keys

- `rowKey: Path<T> | ((row: T) => string | number)`.
- **Duplicates** emit `DK_DUPLICATE_ROW_KEY` and get the fallback keys `key#1`, `key#2`. The `fix` names fields that are unique across all rows, computed by a scan.
- **Missing or `null` keys** emit `DK_MISSING_ROW_KEY` and get the fallback `#index`.

### 5.3 Data checks (on `data:ingest`)

| Check | Code |
|---|---|
| Column path absent in all rows | `DK_COLUMN_PATH_NOT_FOUND` with a nearest-path suggestion (Levenshtein via `ex-search` `Scorer.levenshtein`) |
| Path absent in some rows | `DK_COLUMN_PATH_PARTIAL` (count + sample indices) |
| Rows with differing key sets (zero-config) | `DK_INCONSISTENT_ROW_SHAPE` |
| Same array reference, contents changed (dev: length + sampled hash) | `DK_DATA_MUTATED` |
| Client-mode data large enough to exceed the interaction budget | `DK_PERF_HINT` with numbers from the tracer |

---

## 6. Built-in features

### 6.1 `columnFilters()`

- **State:** `{ [columnId]: FilterValue }`, typed per column via `FilterFor<PathValue>`.

| Type | Applies to | Value | Semantics |
|---|---|---|---|
| `equals` | primitives | `V` | strict equality |
| `contains` | string | `string` | case-insensitive, NFC-normalised (Thai combining marks compare correctly) |
| `in` | primitives | `V[]` | set membership |
| `range` | number / bigint / Date | `{ min?, max? }` | inclusive bounds |
| `custom` | any | user-defined | `fn(value: V, filterValue, row) => boolean` |

- Multiple column filters combine with AND. `undefined` or `''` means inactive.
- A `null` / `undefined` cell value matches no active filter.
- Array-valued cells match if **any** element matches.
- A value of the wrong runtime type is a non-match and emits `DK_FILTER_TYPE_MISMATCH`.

### 6.2 `validity()`

- **State:** `'all' | 'valid' | 'invalid'` (default `'all'`).
- Active only with `invalidRows: 'flag'`. Otherwise it is a no-op, and setting it emits `DK_OPTION_NO_EFFECT`.

### 6.3 `search()`

**Options**

```ts
search({
  mode: 'client' | 'server',
  threshold: 0.3, fuzzyMaxDistance, caseSensitive: false, useWorker: false,
  typing: {
    strategy: 'debounce' | 'throttle' | 'immediate',   // default: client 'immediate', server 'debounce'
    wait: 300 | { seconds: 1, ms: 500 },               // kk-debounce temporal object; default (server) 300 ms
    behavior: 'trailing' | 'leading',
    minLength: 0 | 2,                                  // default: client 0, server 2; shorter input = empty query
    commitOn: 'type' | 'enter',                        // 'enter' → only flushSearch() commits
  },
  searchFn?: (ctx: { query, rows, columns, signal }) => Result | Promise<Result>,
})
// Result = readonly T[] (references from ctx.rows) | { keys: RowKey[] }
```

- **State:** `{ input, query, status: 'idle' | 'pending' | 'searching' | 'error', error? }`.
  - `input` updates immediately as the user types.
  - `query` is the applied value.
  - `pending` means a debounce is waiting; `searching` means a promise is in flight.
- **Typing timing** uses `kk-debounce` `debouncedSignal` (`value` ↔ `input`, `isPending` ↔ `pending`, `flush()` ↔ Enter, `cancel()` ↔ clear/destroy) and `throttle`. Imports go through the `kk-debounce/debounceSignal` and `kk-debounce/throttle` subpaths only.
- **Abort is owned by DataKable** (via the `asyncControl` interceptor, T18). kk-debounce 1.1.0 fixed [kk-debounce#28](https://github.com/Ink01101011/kk-debounce/issues/28): `autoAbort` + `withSignal: true` now pass a signal to the callback and abort it. DataKable still owns async control because:
  - the debounced function returns `void`, so no result reaches the caller;
  - a callback that ignores the signal still runs to completion;
  - a throwing async callback causes an unhandled rejection;
  - there is no timeout;
  - non-debounced requests (the fetcher on page / sort change) are outside kk-debounce.
- **Client matching** (`ex-search`):
  - Searchable columns are those with `search: weight` (zero-config: every displayable column, weight 1).
  - Matching runs on the **formatted** value (what the user sees; arrays joined).
  - The searchable values are projected into flat objects `{ c0, c1, … }`, which also removes ex-search's top-level-key limitation. The projection and the `ExSearch` instance are memoised per data + columns, not per keystroke.
  - Results map back to the original rows **by index**, because ex-search returns copies (identity lost — verified).
  - A blank or whitespace-only query returns all rows (ex-search returns `[]` for it — verified).
- **Ordering:** with no active sort, results are ordered by relevance (score descending, ties by original index, enforced by DataKable). An active sort wins over relevance.
- **Promise API:**
  - `setSearch(q)` and `flushSearch()` return a `Promise<{ status: 'applied' | 'superseded' | 'error' }>`. They never reject.
  - While a search is `searching`, the row model keeps showing the previous results.
  - Errors emit `DK_SEARCH_FAILED` and keep the previous results (stale-while-error). `AbortError` is not counted as an error.
- **API:** `setSearch`, `flushSearch`, `cancelSearch`, `clearSearch`.

### 6.4 `sorting()`

- **State:** `{ by: { id, desc }[] }` (multi-column).
- `toggleSort(id, { multi })` cycles asc → desc → none. React uses Shift+click on the header; this is a different target from Spec 2's row Shift+click.
- **Comparator:**
  - `null` / `undefined` / `NaN` / invalid Date always sort last, in both directions.
  - Mixed types order by type rank first.
  - Strings compare with `Intl.Collator(locale, { numeric: true })`.
  - Overrides: `sortFn` (typed `V`) or `sortBy`.
  - Object columns are sortable only with `sortFn` / `sortBy` (a compile error otherwise).
- **`algorithm: 'auto'`** (default), chosen per sort from one O(n) scan. Only stable algorithms are eligible.

| Condition | Algorithm |
|---|---|
| single column, all keys safe integers (incl. `Date.getTime()`), nearly sorted (few descents) | `exsorted` `timSort` |
| … key range ≤ ~4n | `exsorted` `countingSort` |
| … n ≥ 10k | `exsorted` `radixSort` (desc via negated key, still stable) |
| … otherwise (not nearly sorted, wide range, n < 10k) | `exsorted` `timSort` |
| strings, floats, multi-column, custom `sortFn` | native `Array.prototype.sort` (stable since ES2019) |

- Sorting operates on index arrays through a key selector over the column cache. exsorted's in-place algorithms get a copy (timSort mutates its input — verified).
- **Overrides:** table-level `sorting({ algorithm: 'tim' | 'radix' | 'counting' | 'merge' | 'native' | (indices, cmp) => indices })`, or column-level `sortAlgorithm`.
- `DK_SORT_STRATEGY` (info, debug only) reports the algorithm chosen, the reason, n and the time taken.
- **Benchmark evidence** (Node 25.2.1, median ms; every algorithm passed the stability and correctness check):

| Case | tim | radix | counting | native |
|---|---|---|---|---|
| int keys 1M random | 138 | **59** | throws (range) | 238 |
| int keys 100k random | 9.6 | 4.9 | **3.2** | 15.7 |
| int keys 1M few-unique | 81 | 19 | **11.5** | 79 |
| int keys 100k sorted | **0.14** | 4.0 | 0.93 | 0.77 |
| strings 100k (Intl.Collator th) | 165–233 | n/a | n/a | **80–238** |

  `radixSort` and `countingSort` throw on non-integer keys or `NaN`. `countingSort` throws on a wide key range.

### 6.5 `pagination()`

- **State:** `{ pageIndex: 0, pageSize: 10 }`.
- **API:** `setPageIndex`, `setPageSize`, `nextPage`, `prevPage`, `getPageCount`, `canNextPage`, `canPrevPage`.
- `setPageSize` keeps the first visible row on screen (`floor(firstRow / newSize)`).
- `autoResetPageIndex: true` resets to page 0 when search, filters or sort change.
- `pageIndex` is clamped when the row count shrinks.
- Omitting the feature means no pagination.
- **Server mode:** the page count is `ceil(rowCount / pageSize)`. `rowCount` comes from the fetcher result, or from the `rowCount` option when there is no fetcher (§7.1). Server-mode pagination with neither emits `DK_ROW_COUNT_MISSING` (warn); the page count falls back to `data.length` treated as the total (one page, `canNextPage()` false).

### 6.6 Row model output

`getRowModel()` returns `{ rows: Row<T>[] /* visible page only */, filteredCount, totalCount, status }`.

`status: 'idle' | 'validating' | 'pending' | 'searching' | 'error'`

| Status | Meaning |
|---|---|
| `'idle'` | the row model is current |
| `'validating'` | an async schema is running (§5.1) |
| `'pending'` | a search debounce is waiting, or time-sliced work is in progress (§9.1) |
| `'searching'` | an async request (`searchFn`, fetcher) is in flight |
| `'error'` | a diagnostic affected the row model; the last good row model is shown |

**Rule:** any diagnostic that affects the row model sets `status: 'error'`.

`Row<T>` is a class instance with its methods on the prototype: `key`, `index`, `original`, `valid`, `issues`, `getValue(id)`, `getCellIssues(id)`.

---

## 7. Data modes and SSR

### 7.1 Mode per feature

Every pipeline feature takes `mode: 'client' | 'server'`.

- **Ordering rule:** server steps must form a **prefix** of the pipeline, with client steps after them. For example, server filter + search followed by client sort + paginate is allowed. Server paginate followed by client search is not, because the client would only see one page. A violation throws `DatakableConfigError` (`DK_MODE_ORDER`) at creation, naming both features and offering the two valid fixes.
- **Server source:**
  - `fetcher({ query, filters, sort, pageIndex, pageSize, signal })` → `{ rows, rowCount }`. It receives only the state of the server-mode steps.
  - Response shape is validated (`DK_FETCH_BAD_RESPONSE`, e.g. a missing `rows`, or `rowCount < rows.length`).
  - The fetcher runs through `async:request`: latest-wins, AbortController, a `timeout` (default 30 s → `DK_ASYNC_TIMEOUT`), and failures emit `DK_FETCH_FAILED` while keeping the previous rows.
  - Schema validation and data checks still apply to the returned rows.
- **Server mode without a fetcher** (v1): with `mode: 'server'` and no `fetcher`, core only holds the state of the server-mode steps (their `rowModel` is skipped). The app fetches data itself and passes the current page as `data` plus the total as the `rowCount` option. Server-mode pagination uses `rowCount` for the page count; without it → `DK_ROW_COUNT_MISSING` (§6.5).
- A `fetcher` without any server-mode feature throws `DatakableConfigError` (`DK_FETCHER_WITHOUT_SERVER_MODE`) at creation, naming the fix: set `mode: 'server'` on the features the server handles, or remove `fetcher`.

### 7.2 SSR

- `initialState` (e.g. parsed from the URL) and `initialData` (server mode) are supported.
- Client-mode features run during server render: `?q=ada` produces pre-filtered HTML.
- `getServerSnapshot` derives from `initialState`. Hydration does not re-fetch when `initialData` is present.
- An async `searchFn` does not run on the server: the table uses `initialData`, or starts in `status: 'pending'` and searches after hydration (`DK_SSR_ASYNC_DEFERRED`, info).
- Server snapshot ≠ hydration snapshot → `DK_HYDRATION_MISMATCH`, naming the differing slice.
- `initialState` keys that no longer exist are dropped with `DK_STATE_UNKNOWN_KEY`.

---

## 8. Diagnostics, explain and versioning

### 8.1 Diagnostic shape

```ts
interface Diagnostic {
  code: DiagnosticCode            // stable public API; never reused or redefined
  level: 'error' | 'warn' | 'info'
  problem: string                 // what happened, instance-specific
  where: Location                 // where in the developer's code/data
  impact: string                  // consequence + fallback the system applied
  fix: string[]                   // concrete, computed from real data, best first
  docs: string                    // docs/errors.md#<code> (+ query params in prod)
  details: Record<string, unknown>// redacted
  context: DiagnosticContext
  fingerprint: string             // code + where → Sentry grouping
  toJSON(): object                // safe serializer: bigint, cycles, Errors
}

type Location =
  | { kind: 'column'; index: number; id: string }
  | { kind: 'feature'; name: string }
  | { kind: 'option'; path: string }
  | { kind: 'row'; index: number; key?: string }      // key hashed under 'safe'

interface DiagnosticContext {
  table: string                   // options.name, else "table#n"
  createdAt?: string              // dev: creation site from stack, e.g. "UsersPage.tsx:42"
  package: string                 // "@datakable/core@x.y.z"
  trigger: 'init' | 'data-change' | 'setOptions' | 'hydrate' | 'fetch' | `api:${string}`
  run: number                     // pipeline run id — joins explain() and other diagnostics
  phase: 'ssr' | 'hydrate' | 'client'
  mode: Record<string, 'client' | 'server'>
  state: { searchLength: number; activeFilters: string[]; sort: string[]; page: number }  // never raw input
  occurrences: { count: number; first: number; last: number }
  causedBy?: string               // e.g. "DK_SCHEMA_INVALID_ROW#run57"
  cause?: unknown                 // original Error (ES2022 cause) — passed to onDiagnostic only
}
```

**Console format** (dev, `'keys'`):

```
✖ [DataKable UsersTable] DK_DUPLICATE_ROW_KEY: rowKey "id" is not unique
  where   rows #3, #17, #90 share id = 42
  impact  rendered with fallback keys 42#1, 42#2 — updates may hit the wrong row
  fix     1. rowKey: 'uuid' (unique in all 1,203 rows)
          2. rowKey: (row) => `${row.id}-${row.branch}`
  docs    …/docs/errors.md#dk_duplicate_row_key
  context trigger=data-change run=12 phase=client
```

### 8.2 Emission, redaction, sinks

- **Pipeline:** `diagnostic:emit` → `enrich` (context) → `redact` → `dedupe/rateLimit` → sinks.
- **Sinks:**
  - `onDiagnostic(d)` (user, e.g. Sentry);
  - the default console sink: dev uses `console.groupCollapsed` per code; prod logs `error` level only;
  - `strict: true` rethrows `error` level as `DatakableError`.
- **Dedupe:** one report per code + `where` per data reference, aggregated (`occurrences`). A rate limit protects the console.
- **Bounded memory:** `getDiagnostics()` is backed by a 100-entry ring buffer, and the dedupe map is bounded.
- **Redaction** (`diagnostics.redact`):

| Level | Includes | Default for |
|---|---|---|
| `'safe'` | paths, indices, counts, value *types* (`string(12)`), row keys as short FNV-1a hashes | production |
| `'keys'` | `'safe'` + raw row-key values | development |
| `'full'` | + row values (warns if enabled in production) | — |

  - A column with `sensitive: true` is never logged at any level. A `rowKey` column is always hashed.
  - A custom `redact(path, value) => string | undefined` can be supplied.
  - Schema messages are replaced by the issue path plus DataKable's own text under `'safe'` / `'keys'`, because validators embed received values.
  - Fetcher errors are printed as `error.name` + code only. The full error goes to `onDiagnostic` as `cause`.
- **Production stripping:** `problem` / `fix` text builders, `devChecks`, deprecation texts and the tracer are behind `process.env.NODE_ENV !== 'production'`. Prod diagnostics keep `code`, `where`, `context` and a docs URL with parameters. `import 'datakable/messages'` opts back into full text.
- **Language:** all messages are English-only in v1. The stable `code` is the reference; localisation is v2+ (§2).

### 8.3 Diagnostic catalog

Every code requires: a `defineDiagnostic` entry, an anchor in `docs/errors.md`, and at least one fault-injection test. CI fails otherwise.

Each code's section in `docs/errors.md` has: problem / common causes / fix / example.

| Group | Code | Level | Trigger | Fallback / fix highlights |
|---|---|---|---|---|
| Keys & data | `DK_DUPLICATE_ROW_KEY` | error | duplicate `rowKey` values | fallback `key#n`; suggests unique fields |
| | `DK_MISSING_ROW_KEY` | error | missing / null key | fallback `#index` |
| | `DK_COLUMN_PATH_NOT_FOUND` | warn | path absent in all rows | did-you-mean path |
| | `DK_COLUMN_PATH_PARTIAL` | info | path absent in some rows | count + samples; `format` default |
| | `DK_INCONSISTENT_ROW_SHAPE` | info | zero-config key sets differ | lists the differing keys |
| | `DK_UNRENDERABLE_VALUE` | warn | object/function value without cell/format | renders `''` |
| | `DK_DATA_MUTATED` | warn | same data reference, mutated (dev) | tells the developer to pass a new array |
| Schema | `DK_SCHEMA_INVALID_ROW` | error | validation issues | per `invalidRows`; `fix` maps the schema issue path to the affected column, gives the row count, and says whether the rows were dropped or flagged |
| | `DK_SCHEMA_CRASHED` | error | the schema threw | synthetic issue; per `invalidRows` |
| Features | `DK_FILTER_TYPE_MISMATCH` | warn | filter kind vs value type | non-match; suggests coercion or another kind |
| | `DK_SORT_COMPARATOR_INVALID` | warn | `sortFn` returns NaN or is inconsistent (dev, sampled) | falls back to the default comparator |
| | `DK_SORT_STRATEGY` | info | algorithm chosen (debug) | — |
| | `DK_SEARCH_FAILED` | error | `searchFn` rejected or threw | previous results kept |
| Async | `DK_FETCH_FAILED` | error | fetcher rejected or threw | previous rows kept |
| | `DK_FETCH_ABORTED` | info | superseded request (debug) | — |
| | `DK_FETCH_BAD_RESPONSE` | error | malformed fetcher result | previous rows kept |
| | `DK_ASYNC_TIMEOUT` | error | async op exceeded `timeout` | aborts; previous results kept |
| | `DK_ROW_COUNT_MISSING` | warn | server-mode pagination with no fetcher and no `rowCount` option | page count from `data.length` (one page); pass `rowCount` |
| Callbacks & plugins | `DK_CALLBACK_FAILED` | error | any user callback threw (`where` = slot + row) | slot fallback |
| | `DK_CALLBACK_BAD_RETURN` | warn | slot contract violated (e.g. `format` returned a non-string, `cell` returned a Promise) | coerced / fallback |
| | `DK_FEATURE_FAILED` | error | a feature `rowModel` / `createApi` threw | step passes through |
| | `DK_FEATURE_BAD_OUTPUT` | error | `rowModel` returned a non-index-array | step passes through |
| | `DK_FEATURE_MUTATED_INPUT` | warn | `rowModel` mutated its input (dev) | — |
| | `DK_INTERCEPTOR_FAILED` | error | an interceptor threw | interceptor skipped |
| | `DK_LISTENER_FAILED` | error | a subscribe listener threw | other listeners still run |
| Options & config | `DK_UNKNOWN_OPTION` | warn | unknown option key | did-you-mean |
| | `DK_INVALID_OPTION` | error (config) | wrong runtime type or range | names the accepted values |
| | `DK_OPTION_NO_EFFECT` | warn | the option is ignored in this configuration (e.g. `invalidRows: 'flag'` without `schema`; `validity` outside flag mode) | explains why |
| | `DK_MODE_ORDER` | error (config) | client step before a server step | two valid fixes |
| | `DK_FETCHER_WITHOUT_SERVER_MODE` | error (config) | `fetcher` given but no feature is in server mode | set `mode: 'server'` on the server-handled features, or remove `fetcher` |
| | `DK_FEATURE_DUPLICATE` | error (config) | two features with the same `name` | — |
| | `DK_FEATURE_API_CONFLICT` | error (config) | two features expose the same method | names both features; suggests a namespace |
| | `DK_FEATURE_INCOMPATIBLE` | error (config) | `requires.core` unmet | required version |
| | `DK_CONTROLLED_WITHOUT_HANDLER` | warn | `state` slice passed without `onStateChange` | interactions are frozen; how to fix |
| | `DK_UNSTABLE_COLUMNS` | warn | new `columns` reference every render with the same shape (react, dev) | `useMemo` / hoist |
| | `DK_STATE_UNKNOWN_KEY` | warn | `initialState` / state references a missing column or slice | key ignored |
| Lifecycle & SSR | `DK_TABLE_DESTROYED` | warn | API used after `destroy()` | no-op |
| | `DK_UPDATE_LOOP` | error | re-entrant updates exceed the depth limit | update dropped |
| | `DK_HYDRATION_MISMATCH` | warn | server ≠ hydration snapshot | names the slice |
| | `DK_SSR_ASYNC_DEFERRED` | info | async `searchFn` deferred to the client | — |
| | `DK_RENDER_FAILED` | error | a child component inside `cell` threw (react boundary) | error state |
| Versions | `DK_DEPRECATED` | warn | deprecated API used (once per API per session) | replacement + codemod |
| | `DK_DUPLICATE_CORE` | error | two core copies registered on `globalThis[Symbol.for('datakable')]` | `pnpm why` / dedupe / overrides |
| | `DK_VERSION_MISMATCH` | warn | core / react / datakable versions differ | the aligning command |
| | `DK_DEP_INCOMPATIBLE` | warn | a dependency was overridden to an incompatible version (feature-detected) | native or contains fallback; supported range |
| Environment & perf | `DK_ENV_FALLBACK` | info | missing `Intl.Collator` locale, `AbortSignal.any`, `Worker` or `scheduler.yield` | names the fallback used |
| | `DK_PERF_HINT` | info | a measured step exceeds its budget | server mode / worker suggestion with numbers |
| Catch-all | `DK_INTERNAL` | error | an unclassified throw from DataKable code | "likely a DataKable bug" + prefilled GitHub issue link (version, run, `explain()` summary, redacted context) |
| | `DK_UNKNOWN` | error | anything not classifiable | full context retained |

`DatakableConfigError` (thrown at creation) uses the same shape: code, problem, where, fix, docs.

### 8.4 `explain()` and `explainRow(key)`

These are part of the v1 core API and are usable from the console, tests and the server.

```
table.explain()
  run 57 · trigger setSearch · 1,203 rows → schema 1,198 (5 dropped) → filter 340 → search 12
         → sort native 0.4 ms → page 1/2 (10) · 2 open diagnostics

table.explainRow(42)
  ✓ schema   valid
  ✓ filter   price range {min: 100} → 120 passes
  ✗ search   query (8 chars) score 0.21 < threshold 0.3   ← removed here
  fix        search({ threshold: 0.2 }) or check the query spelling
```

- `explainRow` replays each step's `rowModel` on a single row, so normal runs carry no per-row bookkeeping.
- `explain` uses the last run's tracer counts. In prod, where the tracer is off by default, it recomputes on demand.
- Both outputs go through the redaction policy.

### 8.5 Versioning

- **Deprecation:**
  - `@deprecated` JSDoc on the API;
  - `defineDeprecation` catalog → `DK_DEPRECATED` once per API per session, carrying `since`, `removeIn`, the replacement and an optional codemod;
  - deprecated for ≥ 1 minor before removal in the next major; the changeset must name the replacement.
- **Error codes are public API:** never reused or redefined. Retired codes stay documented, marked with their removal version.
- **Conflicts:**
  - the global registry detects duplicate cores (`DK_DUPLICATE_CORE`);
  - version comparison across the fixed group (`DK_VERSION_MISMATCH`);
  - feature-detection of `exsorted` / `ex-search` / `kk-debounce` capabilities (`DK_DEP_INCOMPATIBLE`);
  - feature `requires` (`DK_FEATURE_INCOMPATIBLE`).

### 8.6 Error handling guarantees

- **Config errors** (deterministic programmer errors, the `error (config)` codes in §8.3) throw `DatakableConfigError` at creation.
- Any diagnostic that affects the row model sets `status: 'error'` (§6.6) and keeps the last good row model.
- **Data and runtime problems never throw**, except under `strict: true` or `invalidRows: 'throw'`.
- Every user callback is invoked inside an `errorBoundary` scope with a slot `where`. Every public method and pipeline step is guarded. Unknown errors are classified as `DK_INTERNAL` (stack in DataKable code) or `DK_UNKNOWN`.
- Every promise DataKable creates is handled. There are no unhandled rejections.
- **Known limits** (documented, not handled):
  - an error thrown by a component that `cell` renders, outside DataKable's boundary;
  - a synchronous infinite loop inside a user callback, which JavaScript cannot interrupt.

---

## 9. Performance and memory

### 9.1 Design rules

- **Index pipeline:** every step consumes and produces `Uint32Array` row indices. `Row` objects are created only for the visible page.
- **Column cache:** created lazily, only for columns used by filter, sort or search. Numeric columns use `Float64Array`. The cache lives in a `WeakMap` keyed by the data reference, so it is released when the data changes.
- The search projection is built only while a query is active.
- **Interceptors:**
  - cold ops use compiled chains;
  - hot ops use batch granularity with an inline `try/catch` and lazy `where`;
  - hot-op ctx objects are pooled.
- **Time-slicing:** work that can exceed 50 ms (projection or column-cache builds at large N) yields through `scheduler.yield()`, falling back to `setTimeout`. `status` is `'pending'` meanwhile.
- **Everything is bounded:** the diagnostic ring buffer (100), the dedupe map, a trace of the last run only (counts, not rows), and `getInvalidRows` stores indices + issues rather than copies.
- **Bundle:**
  - one entry per feature;
  - dependency imports through subpaths where the package has them (never the `exsorted` root, which is 4.6 KB gzip for all 20 algorithms; `ex-search` has none, §12);
  - dev machinery stripped in prod.

### 9.2 Evidence (Node 25.2.1)

| Measurement | Option | Time | Memory |
|---|---|---|---|
| filter + sort, 100k rows | Row wrappers + arrays | 5.70 ms | ≈18.4 MB |
| | **index pipeline + column cache** | **4.22 ms** | **≈3.1 MB** |
| `format` × 5 cols × 100k | per-call ctx + `where` string | 15.90 ms | ≈45.3 MB |
| | **batch, inline try/catch, lazy where** | **7.14 ms** | **≈8.4 MB** |
| interceptor chain, 1M calls | raw 40.9 · inline try/catch 40.9 · compiled chain + reused ctx 47.0 · new ctx 61.5 · 3 interceptors 57.3 | | |

| Dependency import (esbuild 0.27.7, min + gzip) | gzip |
|---|---|
| `exsorted` tim | 1.2 KB |
| `exsorted` radix + counting | 1.2 KB |
| `ex-search` createSearch + Scorer | 3.7 KB |
| `kk-debounce` debounceSignal + throttle | 0.8 KB |

### 9.3 Budgets (acceptance; enforced in CI)

| Budget | Target |
|---|---|
| `@datakable/core` without search (gzip) | ≤ 8 KB |
| `datakable` default preset + react (gzip) | ≤ 20 KB |
| Boundary overhead per column batch vs raw loop | ≤ +10% |
| Pipeline memory at 100k rows (excluding source data) | ≤ 5 MB |
| Interaction (type / sort / page) on 10k rows, client mode, CPU throttle 4x | < 100 ms |
| Longest task while building the projection for 100k rows | ≤ 50 ms |
| `sort auto` selection overhead at n ≤ 1k vs direct native call | no significant regression (bench) |

The bundle budgets are estimates from measured dependency sizes plus an assumed DataKable code size. The first implementation measures a baseline. If it exceeds a budget, the budget is **discussed with the user** — it is never raised silently.

---

## 10. React binding (`@datakable/react`)

- **`useDataTable(options)`:**
  - creates the store once and subscribes with `useSyncExternalStore` (with `getServerSnapshot`);
  - syncs `data` / `columns` / options through `table.setOptions` in a layout effect, never during render;
  - binds `R = ReactNode`;
  - returns the table API, state and the row model.
- **`columns` identity:** compared by reference. In dev, `DK_UNSTABLE_COLUMNS` fires when a new reference with an identical shape arrives every render. Structural comparison is rejected because `accessor` / `format` changes would then go stale silently.
- **`<DataTable />`:**
  - usable as `<DataTable data={rows} />` (zero-config) or `<DataTable table={useDataTable(...)} />`;
  - renders what the installed features provide:
    - header sort buttons with `aria-sort`;
    - a search input bound to `input`, with a `pending` / `searching` spinner, Enter = `flushSearch`, Esc = `clearSearch`;
    - pagination controls;
    - empty / loading / error states;
    - `data-invalid` / `aria-invalid` on flagged rows and cells.
- **Customisation:** unstyled, with `data-*` hooks only. An optional `datakable/styles.css` is available. `components={{ SearchInput, Pagination, Empty, Loading, Error }}` overrides the defaults.
- **Errors:** an error boundary around the body (`DK_RENDER_FAILED`), and per-cell `cell` throws render `⚠` (`DK_CALLBACK_FAILED`).
- `react` peer: `^18.2 || ^19`. The `"use client"` banner is preserved.

---

## 11. Testing strategy

| Layer | What |
|---|---|
| Unit (vitest) | each feature `rowModel` as a pure function on index arrays; the store; the interceptor compiler; the catalogs; the redactor; the safe serializer |
| Type (`*.test-d.ts`) | every prototype case (paths, nested, loose types, HKT features, `invalidRows: 'flag'` union, interceptor sync/async typing), including negative `@ts-expect-error` cases; pinned key error messages |
| Property (fast-check) | `sort auto` equals a reference stable sort for random inputs, all key kinds and directions; filter and search results are order-preserving subsets; mode-order validation accepts exactly the valid combinations across all 4 steps × 2 modes |
| Fault injection | for every public method and every callback slot, inject a throw → assert a diagnostic with the right code + `where`, a usable row model, and no unhandled rejection |
| Async | fake timers + AbortController: a superseded request has `signal.aborted === true` and its result is never applied, even when the callback ignores the signal; timeouts |
| Redaction | sentinel `"SECRET-123"` in data and errors → absent from every serialized diagnostic and from `explain` output under `'safe'` |
| Catalog | every code has a catalog entry, a `docs/errors.md` anchor, ≥ 1 fault-injection test, a non-empty `where` and a non-empty `fix` |
| Diagnostic context | every diagnostic carries `context.table`, `context.trigger` and `context.run` |
| Versions | loading two core copies triggers `DK_DUPLICATE_CORE` |
| React (testing-library + happy-dom) | header sort + `aria-sort`; search typing with debounce; server-mode abort; cell throw → fallback; SSR `renderToString` with `initialState`, then hydrate without re-fetch |
| Bench / budgets | `vitest bench` + size-limit + memory test + throttled interaction test against §9.3 |
| Lint | no floating promises: use biome's rule if the pinned version has one; otherwise a test-based check (decided in the plan) |

---

## 12. Packaging

- **`@datakable/core` dependencies:** `exsorted`, `ex-search`, `kk-debounce` (1.1.0).
  - `exsorted` and `kk-debounce` are imported through per-function subpaths only.
  - `ex-search` has no per-function subpaths: its exports are only `.`, `./types` and `./react`. Core imports its root, never `./react`.
- **Standard Schema:** the interface is vendored; no dependency.
- **Type leak guard:** DataKable's `.d.ts` files must not re-export `ex-search` types, because those reference `ex-flow`. CI compiles a tiny consumer project with `skipLibCheck: false`.
- **Per-feature entries** (`@datakable/core/search`, …) keep the build tree-shakeable. `datakable` exposes the default preset. `datakable/messages` is the opt-in for full prod messages.
- **Existing conventions are kept:** tsup dual ESM/CJS, `exports` with per-condition types, `sideEffects: false` (with an explicit exception for `messages` / `styles.css`), the Changesets fixed group, publint + attw.

---

## 13. Probes run for this spec (reproducible from the session scratchpad)

1. npm metadata + installs of exsorted 1.2.3, ex-search 1.1.1, kk-debounce 1.0.7: exports, peer deps, runtime imports.
2. ex-search output shape: identity loss, blank-query behaviour.
3. exsorted: stability, in-place mutation, signatures, radix/counting edge cases.
4. tsc prototypes: column types (`proto.ts`), loose types (`anyp.ts`), HKT features (`feat.ts`), custom type-error attempts (`msg.ts`, `vA.ts`, `vB.ts`), interceptor typing (`icpt.ts`).
5. Benchmarks: sorting (`bench.mjs`), interceptor overhead (`icpt.ts`), pipeline shape and batch granularity (`opt.mjs`), dependency bundle sizes (esbuild).
6. kk-debounce `autoAbort` probe (`kkprobe.mjs`) → [kk-debounce#28](https://github.com/Ink01101011/kk-debounce/issues/28), fixed in kk-debounce 1.1.0 (§6.3).
