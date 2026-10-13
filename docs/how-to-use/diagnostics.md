# Diagnostics

DataKable never fails silently: every problem it detects becomes a **diagnostic**, an object with a
stable `DK_*` code, the exact place in your code or data, what the table did instead and a concrete
fix. This page explains where diagnostics go and how to route them (`onDiagnostic`, the console,
`getDiagnostics()`), what they may contain (redaction), what production builds keep, and the two
debugging tools that answer "where did my rows go?": `explain()` and `explainRow()`. The meaning of
each code is in the [diagnostics reference](../how-to-fix/errors.md).

## Two kinds of problems

- **Configuration mistakes** are thrown at creation as `DatakableConfigError`: an invalid option
  value, two features with the same name, a client step before a server step, a `fetcher` without
  a server-mode feature. They are deterministic programmer errors, so the table is not created.
  Given to `setOptions()` instead, the call throws and the previous options are kept.
- **Data and runtime problems never throw.** A duplicate row key, a `format` that throws, a failed
  request or a filter on the wrong type is reported, the table applies a fallback (a fallback key,
  `''` in that cell, the previous rows) and keeps working on the last good snapshot. The only
  exceptions are `strict: true` and `invalidRows: 'throw'`.

A diagnostic that affects the row model (a failed step, ingest, fetch or search) also sets
`getRowModel().status` to `'error'`; a cell-level problem handled inside a step does not. See the
[status model](core-concepts.md).

```ts
import { createTable, type Diagnostic } from 'datakable'

type User = { id: number; name: string; email: string }
declare const users: User[]
declare const Sentry: {
  captureMessage(message: string, context: { level: string; extra: object }): void
}

const table = createTable({
  name: 'UsersTable', // context.table in every diagnostic (default: table#1, table#2, …)
  data: users,
  rowKey: 'id',
  onDiagnostic: (d: Diagnostic) => {
    // Called once per code and `where` per data reference (repeats raise context.occurrences.count).
    if (d.level === 'info') return
    Sentry.captureMessage(`${d.code} at ${JSON.stringify(d.where)}`, {
      level: d.level === 'error' ? 'error' : 'warning',
      extra: d.toJSON(), // safe: no context.cause, bigint and cycles handled
    })
  },
})

// The last 100 diagnostics, oldest first.
for (const d of table.getDiagnostics()) {
  console.log(d.code, d.level, d.where, d.fix[0], d.docs)
}
```

`DatakableConfigError` extends `DatakableError`, which carries the diagnostic's `code`, `level`,
`problem`, `where`, `impact`, `fix` and `docs`, plus the whole `diagnostic`.

## The `Diagnostic` object

| Field | Type | |
| --- | --- | --- |
| `code` | `DiagnosticCode` | `DK_*`, stable public API: never reused or given another meaning |
| `level` | `'error' \| 'warn' \| 'info'` | |
| `problem` | `string` | what happened, computed from your data; empty in production unless messages are installed |
| `where` | `Location` | where in your code or data (below) |
| `impact` | `string` | the consequence and the fallback the table applied |
| `fix` | `string[]` | concrete fixes, best first, computed from your data |
| `docs` | `string` | its section of the [diagnostics reference](../how-to-fix/errors.md) |
| `details` | `Record<string, unknown>` | the code's details, already redacted |
| `context` | `DiagnosticContext` | table, trigger, run, phase, … (below) |
| `fingerprint` | `string` | `code@where`: a grouping key for dedupe or an error tracker |
| `toJSON()` | `object` | safe serialisation: bigint, cycles and errors never throw; leaves out `context.cause` |

`where` is one of:

| `kind` | Fields | Printed as |
| --- | --- | --- |
| `'column'` | `index`, `id` | `columns[1] (id "age")` |
| `'feature'` | `name` | `feature "sorting"` |
| `'option'` | `path` | `options.rowCount` (a feature option: `options.sorting.algorithm`) |
| `'row'` | `index`, `key?` | `row #2 (key 42)`; `index` is the position in `options.data`, the key is hashed under `'safe'` |
| `'interceptor'` | `name`, `op` | `interceptor "timing" on column:batch` |
| `'operation'` | `op`, `slot?` | `operation render:cell at columns[1].cell` |

`context` (`DiagnosticContext`):

| Field | |
| --- | --- |
| `table` | `options.name`, else `table#n` |
| `createdAt?` | development: the creation site of the table |
| `package` | `@datakable/core@<version>` |
| `trigger` | what started the work: `'init'`, `'data-change'`, `'setOptions'`, `'hydrate'`, `'fetch'` or `` `api:${method}` `` |
| `run` | the pipeline run id, the same `run` as `explain()` |
| `phase` | `'ssr'`, `'hydrate'` or `'client'` |
| `mode` | the data mode of each pipeline feature, e.g. `{ sorting: 'server' }` |
| `state` | a summary, never raw input: `{ searchLength, activeFilters, sort, page }` |
| `occurrences` | `{ count, first, last }`: repeats of the same diagnostic (below) |
| `causedBy?` | the diagnostic this one follows from |
| `cause?` | the original error; reaches `onDiagnostic` only, never the console or `toJSON()` |

## Where diagnostics go

| Sink | What it gets |
| --- | --- |
| `onDiagnostic` (option) | every diagnostic, with `context.cause`; e.g. forward to Sentry |
| `table.getDiagnostics()` | the last 100, oldest first |
| the console | development: every diagnostic, one collapsed group each; production: `error` level only, on one line |
| `strict: true` (option) | error-level diagnostics are thrown as `DatakableError` |

- **Deduplicated.** A diagnostic is delivered once per code and `where` for one `data` reference;
  repeats raise `context.occurrences.count` on the stored one instead of reaching the sinks again.
  New data (a new array reference) reports it again.
- **Rate-limited console.** At most 20 console reports per second per table; when some were held
  back, one warning says how many. They are still in `getDiagnostics()` and were given to
  `onDiagnostic`.
- **The logger never kills the table.** If `onDiagnostic` (or a `diagnostic:emit` interceptor)
  throws, DataKable prints one `console.error` and stays quiet afterwards.
- **`name`** names the table in every diagnostic and console line; give each table one.

```ts
import { createTable, DatakableConfigError, sorting } from 'datakable'

type User = { id: number; name: string }
declare const users: User[]

try {
  // Two features with the same name: a configuration mistake, thrown at creation.
  createTable({ data: users, features: [sorting(), sorting()] })
} catch (e) {
  if (!(e instanceof DatakableConfigError)) throw e
  console.error(e.code) // 'DK_FEATURE_DUPLICATE'
  console.error(e.where) // { kind: 'feature', name: 'sorting' }
  console.error(e.fix, e.docs)
}
```

`onDiagnostic` is synced by `setOptions` (and by `useDataTable` on every render, as an inline
function); `name` and `strict` are read once, at creation.

### `strict`

`strict: true` rethrows every error-level diagnostic as a `DatakableError` from the call that
caused it. Use it in tests, so that a fixture with duplicate keys or a throwing `format` fails the
test instead of logging:

```ts
import { createTable, DatakableError } from 'datakable'

type User = { id: number; name: string }
declare const fixture: User[]

// In a test: make every error-level diagnostic throw, so a broken fixture fails loudly.
try {
  const table = createTable({ data: fixture, rowKey: 'id', strict: true })
  table.getRowModel()
} catch (e) {
  if (e instanceof DatakableError) console.error(e.code, e.diagnostic.context.run)
  throw e
}
```

## Redaction

Diagnostics end up in consoles, error trackers and bug reports, so DataKable decides what user data
they may carry. Redaction is applied while the diagnostic is built: `details`, `where`, the text,
the fingerprint, `toJSON()`, every interceptor and every sink only ever see the redacted values.

| `diagnostics.redact` | Includes | Default for |
| --- | --- | --- |
| `'safe'` | paths, indices, counts, value *types* (`string(12)`), row keys as short hashes (`h:1a2b3c4d`) | production |
| `'keys'` | `'safe'` + raw row-key values | development |
| `'full'` | `'keys'` + cell values | — |

- A column with `sensitive: true` is never logged, at any level (its values become `[sensitive]`).
  When the `rowKey` column is sensitive, row keys are hashed at every level.
- A function `redact(path, value)` adds your own rule on top of the default level: return a string
  to log instead of `value`, or `undefined` to keep the built-in policy for that field. `path` names
  the field: `where.key`, `details.value`, `details.keys.2`, `details.issues.0`, … Sensitive
  columns never reach it, and a rule that throws logs `[redacted]`.
- Thrown errors (a fetcher's, a `searchFn`'s, a callback's) are logged as `error.name` (and
  `code`) only, since their messages embed URLs, tokens and values. The error itself is
  `context.cause`, passed to `onDiagnostic` only.
- Schema issue messages embed the received value, so under `'safe'` and `'keys'` they are replaced
  by the issue path and DataKable's own text.
- `'full'` in a production build still applies, and reports `DK_UNSAFE_REDACTION`.
- Row-key hashes are unsalted 32-bit FNV-1a hashes: pseudonymisation, not anonymisation. Treat
  hashed diagnostics as personal data wherever the keys are.

```ts
import { createTable } from 'datakable'

type Patient = { id: string; name: string; ssn: string; ward: string }
declare const patients: Patient[]

const table = createTable({
  data: patients,
  rowKey: 'id',
  columns: [
    { key: 'name', sensitive: true }, // never written to any diagnostic, at any level
    { key: 'ssn', sensitive: true },
    { key: 'ward' },
  ],
  diagnostics: {
    // A level ('safe' | 'keys' | 'full'), or a rule on top of the default level. Return a string
    // to log instead of the value, or undefined to keep the built-in policy for that field.
    // `path` names the field: 'where.key', 'details.value', 'details.keys.2', …
    redact: (_path, value) =>
      typeof value === 'string' && value.includes('@') ? '[email]' : undefined,
  },
})

console.log(table.getDiagnostics().map((d) => d.toJSON()))
```

`diagnostics` is read once, at creation. Sensitive columns and the `rowKey` are read on every
report, so `setOptions({ columns })` is followed.

## Production builds

DataKable reads `process.env.NODE_ENV` (your bundler replaces it; see
[Getting started](getting-started.md)). A production build:

- keeps `code`, `level`, `where`, `details` and `context`, and a `docs` URL that also carries
  `?v=<version>&where=<where>`;
- leaves `problem`, `impact` and `fix` empty, because the message text is stripped from the bundle;
- prints only `error` level to the console, on one line:
  `[DataKable UsersTable] DK_FETCH_FAILED at options.fetcher — <docs url>`;
- skips the development-only checks (below).

To keep the full text in production, import the messages once in your app entry
(`@datakable/core/messages` for core-only apps; `datakable/messages` also installs the React
codes):

```ts
// In the app entry. Production builds keep code, level, where, context and a docs URL, and leave
// problem / impact / fix empty; this import installs the full text for every code (core + React).
import 'datakable/messages'
```

**Development-only codes.** These checks are absent from production bundles and never reported
there: the dev checks `DK_DATA_MUTATED`, `DK_CALLBACK_BAD_RETURN`, `DK_FEATURE_BAD_OUTPUT`,
`DK_FEATURE_MUTATED_INPUT`, `DK_SORT_COMPARATOR_INVALID`, `DK_HOT_INTERCEPTOR`, React's
`DK_UNSTABLE_COLUMNS` / `DK_UNSTABLE_OPTION`; the option validator (`DK_UNKNOWN_OPTION`,
`DK_INVALID_OPTION`, `DK_OPTION_NO_EFFECT`); `DK_MODE_ORDER`; the version checks
(`DK_FEATURE_INCOMPATIBLE`, `DK_DUPLICATE_CORE`, `DK_VERSION_MISMATCH`); and the data checks
(`DK_COLUMN_PATH_NOT_FOUND`, `DK_COLUMN_PATH_PARTIAL`, `DK_INCONSISTENT_ROW_SHAPE`). A `schema`,
`fetcher` or `searchFn` that is not wrapped with `withSchema()` / `withFetcher()` /
`withSearchFn()` still throws `DK_INVALID_OPTION` in production. Run your tests in development
mode to catch these.

## `explain()` and `explainRow()`

Both are core table methods, available in every build (also on the server and in tests), and both
go through the same redaction as diagnostics.

```ts
import { createTable } from 'datakable'

type Product = { sku: string; name: string; price: number }
declare const products: Product[]

const table = createTable({ data: products, rowKey: 'sku' })
table.setColumnFilter('price', { type: 'range', value: { min: 100 } })
await table.setSearch('chair')

// Where did the rows go? Counts per step of the last run.
const e = table.explain()
for (const step of e.steps) {
  console.log(step.feature, step.mode, `${step.input} → ${step.output}`, step.cached, step.ms)
}
console.log(e.filteredCount, e.visible, e.page, e.diagnostics)

// Why is this row not shown? Replays one row through the schema and every step.
const why = table.explainRow('SKU-042')
if (why.found && !why.visible) console.log(why.removedBy, why.steps)

// The console report in development (JSON in production).
console.log(String(why))
```

`String(…)` of either result is the console report in development (examples in the
[diagnostics reference](../how-to-fix/errors.md#debugging-tools-explain-and-explainrow)) and the JSON of the
same object in production.

`table.explain()` returns a `TableExplanation`, the last pipeline run:

| Field | |
| --- | --- |
| `run`, `trigger`, `status` | the run id, what triggered it, and the row model's status |
| `rows` | rows after ingest (after the schema dropped invalid rows) |
| `schema?` | with a schema: `{ mode, invalid }` (its `invalidRows` mode and how many rows failed) |
| `steps` | one `ExplainStep` per pipeline feature, in pipeline order |
| `filteredCount` | rows after filter and search (`getRowModel().filteredCount`) |
| `page?` | with pagination: `{ index, count, size }` (0-based page shown, page count, page size) |
| `visible` | rows in `getRowModel().rows` |
| `diagnostics` | error and warning diagnostics in `getDiagnostics()` |
| `traced`, `ms?` | the tracer saw this run, and the run's duration |

Each `ExplainStep` has `feature`, `stage`, `mode` (`'server'`: the server ran it, and its counts
are the rows it was given), `input`, `output`, `cached` (served from the step memo), `failed` (the
step threw or returned a bad output and passed its input through) and `ms?` (traced only).

`table.explainRow(key)` returns a `RowExplanation` for the row with that `rowKey` value:

| Field | |
| --- | --- |
| `key` | the key asked for, redacted (a hash under `'safe'`) |
| `found` | the key exists in the current data (or in the rows the schema dropped) |
| `index?`, `rawIndex?` | position in `getData()`; or in `options.data` for a row the schema dropped |
| `schema` | `'none'`, `'valid'`, `'flagged'` or `'dropped'` |
| `issues?` | schema issues of a flagged or dropped row, as `{ path, message }` (redacted) |
| `steps` | one `RowStep` per pipeline feature: `{ feature, stage, outcome, position?, of?, detail? }` |
| `removedBy?` | the feature that removed the row, or `'schema'` |
| `visible` | the row is in `getRowModel().rows` |
| `run`, `rows` | the run replayed, and the row count after ingest |

A `RowStep`'s `outcome` is `'kept'` (with its `position` in the step output `of` that many rows),
`'removed'` (with the redacted `detail` of why), `'skipped'` (a server-mode step), `'failed'` (the
step passed its input through) or `'not-reached'` (an earlier step or the schema removed the row).
`explainRow` replays each step on the one row, so normal runs keep no per-row bookkeeping.

## The tracer

The timings in `explain()` come from the `tracer` interceptor, which `createTable` installs in
development. It records the last run only (counts, never rows), and reports `DK_PERF_HINT` for a
step that takes more than 50 ms. Production builds leave it out; `explain()` then recomputes the
counts on demand, without timings. To trace a production table, install it yourself (there is no
`trace` option):

```ts
import { createTable, tracer } from 'datakable'

type Product = { sku: string; price: number }
declare const products: Product[]

// Development installs the tracer by itself. In production it is off; opt in to get step timings
// in explain() and DK_PERF_HINT for steps over 50 ms.
const table = createTable({ data: products, rowKey: 'sku', interceptors: [tracer()] })
table.toggleSort('price')
console.log(table.explain().traced, table.explain().ms)
```

## Pitfalls

- **Empty `problem` / `fix` in production.** The text is stripped; read `code` and `docs`, or
  import `datakable/messages`. See [production builds](../how-to-fix/errors.md#production-builds).
- **A diagnostic shows up once.** Repeats for the same data are aggregated in
  `context.occurrences`, not delivered again; pass a new array to see them reported again.
- **Cell values missing from a report.** That is redaction working: values are logged as their
  type unless `redact: 'full'`, and never for `sensitive` columns. See
  [redaction](../how-to-fix/errors.md#redaction) and [`DK_UNSAFE_REDACTION`](../how-to-fix/errors.md#dk_unsafe_redaction).
- **`strict: true` in the app.** It turns recoverable data problems into exceptions; keep it for
  tests.
- **`explain()` without timings in production.** Install `tracer()` to get them
  ([`DK_PERF_HINT`](../how-to-fix/errors.md#dk_perf_hint)).
- **A throwing `onDiagnostic`** is reported once on the console and then silenced; keep the sink
  simple and catch inside it.

## See also

- [Diagnostics reference](../how-to-fix/errors.md) — every `DK_*` code: problem, causes, fix, example.
- [Core concepts](core-concepts.md) — the status model and what sets `'error'`.
- [Custom features and interceptors](custom-features-and-interceptors.md) — `diagnostic:emit`
  interceptors and emitting your own codes.
- [Columns and row keys](columns-and-row-keys.md) — `sensitive` columns and `rowKey`.
- [Performance](performance.md) — `DK_PERF_HINT` and the tracer's cost.
- [`@datakable/core` diagnostics](../../packages/core/README.md#diagnostics)
- [Report diagnostics to an error tracker](../examples/error-reporting.md) and [a logging
  interceptor](../examples/logging-interceptor.md) — recipes.
- [Diagnostics have no text in production](../how-to-fix/diagnostics-without-text-in-production.md)
  — troubleshooting.
