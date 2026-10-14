# Custom features and interceptors

DataKable has two extension points, and the built-ins use exactly the same ones. A **feature**
(`defineFeature`) adds a state slice, methods on the table and, optionally, a step in the row
pipeline: column filters, search, sorting and pagination are features. An **interceptor**
(`defineInterceptor`) wraps an operation the table runs (a state change, a pipeline run, a fetcher
request, a diagnostic) for cross-cutting work such as analytics, timing or company redaction rules.
This page covers writing both, typing them against the row type, and declaring a feature's options
with `defineOptions`.

## Features

A feature is a plain object made with `defineFeature`. `createTable({ features: [...] })` reads the
list once, at creation: each feature adds its slice to the state (under its `name`), merges its API
onto the table, and, with a `stage`, runs its `rowModel` in the pipeline.

| Field | Type | |
| --- | --- | --- |
| `name` | `string` | the state slice key and the feature's name in diagnostics; unique per table |
| `stage` | `'filter' \| 'search' \| 'sort' \| 'paginate' \| 'none'` | where `rowModel` runs; `'none'`: state and API only |
| `mode?` | `'client' \| 'server'` | default `'client'`; a `'server'` feature only holds its state (its `rowModel` is skipped and the state goes to the `fetcher`) |
| `options?` | `OptionsDefinition` | `defineOptions(schema, factoryOptions)`: validated at creation (development) |
| `initialState` | `() => S` | a fresh starting value; `options.initialState[name]` replaces it |
| `createApi` | `(ctx: FeatureContext<S>) => A` | the methods merged onto the table |
| `rowModel?` | `(indices, state, ctx: RowModelContext) => Uint32Array` | the pipeline step: the kept row indices, in output order |
| `destroyedResult?` | `{ [method]: () => unknown }` | what a method returns when called after `destroy()` (default `undefined`); list a method that returns a promise |
| `interceptors?` | `Interceptor[]` | interceptors the feature contributes |
| `requires?` | `{ core: string }` | a semver range of `@datakable/core` the feature needs |

The pipeline always runs `filter → search → sort → paginate`, whatever order the features are
listed in; features of the same stage run in list order. A server-mode step must come before every
client-mode step (`DK_MODE_ORDER`); see [Features](features.md).

### A row-typed feature

The built-ins type their state and API against the row type: `toggleSort('nmae')` does not compile.
Your feature gets the same by declaring its types as type-lambdas over `this['T']`, which the table
replaces with its row type. Write the state and API as hoisted generic types (`this` inside a
nested object literal type is a TypeScript error, TS2526), then pass both type arguments to
`defineFeature`:

```ts
import { defineFeature, defineOptions, type FeatureTypes, type Path } from '@datakable/core'

// 1. The state and API as hoisted generic types over the row type T.
export type ThresholdState<T> = { column: Path<T> | null; min: number }
export type ThresholdApi<T> = {
  /** Keeps the rows whose numeric `column` is at least `min`. */
  setThreshold(column: Path<T>, min: number): void
  clearThreshold(): void
}

// 2. The type-lambdas: `this['T']` becomes the table's row type.
export interface ThresholdTypes extends FeatureTypes {
  state: ThresholdState<this['T']>
  api: ThresholdApi<this['T']>
}

export interface ThresholdOptions {
  /** The starting minimum (default 0). */
  min?: number
}

// Hoisted, so the schema is built once (checked in development only).
const thresholdOptions = {
  min: { type: 'number', check: (v: number) => v >= 0, expected: 'a number ≥ 0' },
} as const

// 3. The factory: options close over the definition.
export const threshold = (opts: ThresholdOptions = {}) =>
  defineFeature<'threshold', ThresholdTypes>({
    name: 'threshold', // the state slice key, unique per table
    stage: 'filter', // runs with the column filters, before search
    options: defineOptions(thresholdOptions, opts),
    initialState: () => ({ column: null, min: opts.min ?? 0 }),
    createApi: (ctx) => ({
      setThreshold: (column, min) => ctx.setState({ column, min }),
      clearThreshold: () => ctx.setState({ column: null, min: opts.min ?? 0 }),
    }),
    // Pure: read the indices, return the kept ones (a new array or a subarray), never mutate.
    rowModel: (indices, state, ctx) => {
      if (state.column === null) return indices
      const values = ctx.getColumnValues(state.column) // cached per data + column
      if (values === undefined) return indices // not a column
      const out = new Uint32Array(indices.length)
      let n = 0
      for (const r of indices) {
        const v = values[r]
        if (typeof v === 'number' && v >= state.min) out[n++] = r
      }
      return out.subarray(0, n)
    },
  })
```

Installed next to the built-ins (the file above is `1-threshold-feature.ts`), the table's state
and API include it, typed against `Product`:

```ts
import { createTable } from '@datakable/core'
import { sorting } from '@datakable/core/sorting'
import { threshold } from './1-threshold-feature'

type Product = { sku: string; name: string; price: number }
declare const products: Product[]

const table = createTable({
  data: products,
  rowKey: 'sku',
  features: [threshold({ min: 10 }), sorting()],
})

table.setThreshold('price', 100) // typed against Product
table.toggleSort('price')
console.log(table.getState().threshold) // { column: 'price', min: 100 }

// @ts-expect-error 'cost' is not a path of Product
table.setThreshold('cost', 100)
```

Inside `rowModel` and `createApi` the row type is `any` (a feature is written once for every row
type): the type checking happens where the table is used.

### A feature that does not depend on the row type

When the state and API do not mention the row type, skip the interface and the type arguments:
`defineFeature` infers both.

```ts
import { createTable, defineFeature } from '@datakable/core'

type Density = 'compact' | 'comfortable'

// State and API do not depend on the row type: no type arguments, both are inferred.
// `stage: 'none'`: state and API only, no pipeline step.
const density = () =>
  defineFeature({
    name: 'density',
    stage: 'none',
    initialState: (): Density => 'comfortable',
    createApi: (ctx) => ({
      setDensity: (value: Density) => ctx.setState(value),
      toggleDensity: () => ctx.setState((d) => (d === 'compact' ? 'comfortable' : 'compact')),
    }),
  })

type User = { id: number; name: string }
declare const users: User[]

const table = createTable({ data: users, features: [density()] })
table.toggleDensity()
const value: Density = table.getState().density
console.log(value)
```

### `FeatureContext` (what `createApi` gets)

| Member | |
| --- | --- |
| `name` | the feature's `name` |
| `getState()` | the current value of the feature's own slice (the controlled value, if the slice is controlled) |
| `setState(updater)` | replaces the feature's own slice, with a value or `(prev) => next`; goes through `state:dispatch`, so controlled slices go to `onStateChange`, the update-loop guard applies, and after `destroy()` it is a no-op |
| `table` | the table: the whole state, `subscribe`, other features' APIs |
| `emit(code, details)` | reports a catalog diagnostic on the table |

API methods are wrapped once: each call runs with the trigger `api:<method>`, listeners are
notified once when the outermost call returns (one notification for several `setState` calls),
and after `destroy()` the call is a no-op that reports `DK_TABLE_DESTROYED`.

### `RowModelContext` (what `rowModel` gets)

| Member | |
| --- | --- |
| `name` | the feature's `name` |
| `data` | the ingested rows; `indices` point into this array |
| `columns` | `options.columns` (the derived columns in zero-config) |
| `run` | the pipeline run id |
| `emit(code, details)` | reports a catalog diagnostic |
| `getColumnValues(id)` | the values of column `id` for every row of `data` (index = row index), or `undefined` for an unknown column; an all-number column is a `Float64Array` (`NaN` for missing values) |
| `getFormattedValues(id)` | the column's formatted strings (its `format`, else the default formatter) |
| `flagged?` | under `schema` + `invalidRows: 'flag'`: the schema issues of a row, `undefined` for a valid one |
| `batch(id, slot, rows, body)` | runs a per-cell user callback over `rows` as one `column:batch` of column `id`, so it is intercepted once per column, never per cell |
| `slice?(key, job)` | time-slicing for work that can exceed 50 ms: returns the job's result, or `undefined` while it runs (return a stand-in; the row model is `'pending'` meanwhile) |

### Rules

- **`rowModel` is pure.** Return the kept indices (a new `Uint32Array` or a `subarray`) and never
  mutate `indices`. Return `indices` itself when nothing changes. The runner memoises each step on
  its input reference and its own slice, so a step runs again only when one of them changes.
- **Read values through the context.** `getColumnValues` is cached per data reference and
  column; reading `ctx.data[r]` paths yourself on every run costs more.
- **Names are unique.** Two features with one `name` throw `DK_FEATURE_DUPLICATE`; an API method
  whose name the table or an earlier feature already has throws `DK_FEATURE_API_CONFLICT` (both at
  creation). Prefix your methods when in doubt.
- **Failures are contained.** `initialState()` or `createApi()` that throws reports
  `DK_FEATURE_FAILED` (the slice starts `undefined`, or the API is missing) and the table is still
  created; a `rowModel` that throws reports it too and the step passes its input through, with
  `status: 'error'`. In development, a step that returns something other than an index array
  (`DK_FEATURE_BAD_OUTPUT`) or mutates its input (`DK_FEATURE_MUTATED_INPUT`) is reported.
- **`requires`** is checked in development: an unmet range throws `DK_FEATURE_INCOMPATIBLE`.

## Feature options: `defineOptions`

`defineOptions(schema, values)` declares a feature's options and the values its factory was called
with. In development, `createTable` checks the values against the schema: an unknown key reports
`DK_UNKNOWN_OPTION` with a did-you-mean (the table is still created), a wrong type or value throws
`DK_INVALID_OPTION` naming the accepted values, and an option that does nothing in this
configuration reports `DK_OPTION_NO_EFFECT`. Production builds skip the check. Hoist the schema (a
module constant, `as const`) so it is built once. Each rule (`OptionRule`):

| Field | Type | |
| --- | --- | --- |
| `type` | `OptionType \| readonly OptionType[]` | `'string'`, `'number'`, `'boolean'`, `'function'`, `'object'`, `'array'` |
| `oneOf?` | `readonly (string \| number \| boolean)[]` | the accepted values (an enum) |
| `check?` | `(value) => boolean` | an extra check once the type matched (a range, an integer) |
| `expected?` | `string` | the accepted values in words, for the problem and fix text |
| `shape?` | `OptionsSchema` | the rules of an object option's keys (their unknown keys are reported too) |
| `once?` | `boolean` | read once: a changed value given to `setOptions` is ignored and reported |
| `noEffect?` | `(value, options) => string \| undefined` | why the option has no effect next to the other options, or `undefined` |

`undefined` always passes: it means "not set".

## Interceptors

Every unit of work in a table is an **operation**, and an interceptor wraps the operations it names
in `on`. It gets a context and `next`, which runs the rest of the chain and the operation itself;
whatever it returns is the operation's result.

| Operation | Kind | Input | |
| --- | --- | --- | --- |
| `table:init` | sync | `{ options }` | creation |
| `table:setOptions` | sync | `{ options, previous }` | `setOptions()` |
| `table:destroy` | sync | — | `destroy()` |
| `state:dispatch` | sync | `{ updater }` | every state change (`setState`, a feature method) |
| `data:ingest` | sync or async | `{ data }` | new data: row keys, schema, data checks |
| `pipeline:run` | sync | `{ rowCount }` | one row model computation |
| `pipeline:step` | sync | `{ stage, feature, indices }` | one feature's step in a run |
| `column:batch` | sync, **hot** | `{ column, slot, rows }` | a per-cell callback (`accessor`, `format`, a filter `fn`, `sortBy`) over one column |
| `async:request` | async | `{ source, params? }` | a `fetcher` or `searchFn` request (`source: 'fetcher' \| 'searchFn'`) |
| `diagnostic:emit` | sync | `{ diagnostic }` | every diagnostic, already redacted, before dedupe and the sinks |

`@datakable/react` adds `render:table` and `render:cell` for `<DataTable />`'s error boundaries.

The context (`ctx`) has `op`, `input`, `where` (the slot or location: a method or feature name,
`columns[2].format`, …), `table`, `run`, `trigger` (`'init'`, `'setOptions'`, `` `api:${method}` ``,
…), `phase` (`'ssr'`, `'hydrate'`, `'client'`), `meta` (a `Map` shared by the interceptors of one
call), `emit(code, details)` and, for requests, `signal`. `defineInterceptor` infers the
operations from `on` and types `ctx.input` and `next()` by them: `on: ['state:dispatch']` gives
`ctx.input.updater`, and a list of several operations gives a union narrowed by `ctx.op`.

```ts
import { createTable, defineInterceptor } from 'datakable'

type User = { id: number; name: string; age: number }
declare const users: User[]
declare function track(event: string, props: object): void

// After every committed state change: which method changed what (sync op, sync next()).
const analytics = defineInterceptor({
  name: 'analytics',
  on: ['state:dispatch'],
  intercept(ctx, next) {
    const out = next()
    // ctx.trigger: 'api:toggleSort', 'api:setState', …; ctx.where: the feature or 'setState'.
    track('table-state', { trigger: ctx.trigger, slice: ctx.where, run: ctx.run })
    return out
  },
})

const table = createTable({ data: users, rowKey: 'id', interceptors: [analytics] })
table.toggleSort('age') // track('table-state', { trigger: 'api:toggleSort', slice: 'sorting', … })
```

`diagnostic:emit` sees every diagnostic before the sinks (`onDiagnostic`, the console,
`getDiagnostics()`), already redacted. Not calling `next()` drops it; changing it before `next()`
changes what the sinks get (the fingerprint is not recomputed):

```ts
import { createTable, defineInterceptor } from 'datakable'

type User = { id: number; name: string }
declare const users: User[]

// Every diagnostic passes through `diagnostic:emit` (already redacted) before dedupe and sinks.
const quiet = defineInterceptor({
  name: 'quiet-info',
  on: ['diagnostic:emit'],
  intercept(ctx, next) {
    const d = ctx.input.diagnostic
    // Drop: do not call next(). The diagnostic reaches no sink and getDiagnostics().
    if (d.level === 'info') return undefined
    // Rewrite: change it before the sinks see it.
    d.fix = [...d.fix, 'Team guide: wiki/tables#diagnostics']
    return next()
  },
})

createTable({ data: users, rowKey: 'id', interceptors: [quiet] })
```

The type of `next()` follows the operation's kind: a sync operation returns its result, an async
one a `Promise`. An interceptor on a sync operation that returns a `Promise` does not compile.

```ts
import {
  createTable,
  defineInterceptor,
  type FetchResult,
  pagination,
  withFetcher,
} from 'datakable'

type User = { id: number; name: string }
declare function report(metric: string, ms: number, extra: object): void

// A sync op: next() returns the result itself, and so must the interceptor.
const pipelineTiming = defineInterceptor({
  name: 'pipeline-timing',
  on: ['pipeline:run'],
  intercept(ctx, next) {
    const start = performance.now()
    try {
      return next()
    } finally {
      report('pipeline', performance.now() - start, { rows: ctx.input.rowCount, run: ctx.run })
    }
  },
})

// An async op: next() returns a Promise, and the interceptor must return one.
const requestTiming = defineInterceptor({
  name: 'request-timing',
  on: ['async:request'],
  async intercept(ctx, next) {
    const start = performance.now()
    try {
      return await next()
    } finally {
      report('request', performance.now() - start, { source: ctx.input.source })
    }
  },
})

createTable({
  rowKey: 'id',
  features: [pagination({ mode: 'server' })],
  fetcher: withFetcher(
    async ({ pageIndex, signal }) =>
      (await (await fetch(`/api/users?page=${pageIndex}`, { signal })).json()) as FetchResult<User>,
  ),
  interceptors: [pipelineTiming, requestTiming],
})
```

### Order and safety

- From the outside in: the `errorBoundary` (always outermost, cannot be removed), the async request
  control (once the table has a `fetcher` or `searchFn`), the tracer (development), the features'
  interceptors (in pipeline order), then `options.interceptors` in list order, then the operation.
- An interceptor that throws is reported as `DK_INTERCEPTOR_FAILED` and skipped: when it threw
  before calling `next()`, the chain continues without it; after, the result `next()` produced is
  kept, so the operation never runs twice.
- `column:batch` is **hot**: it runs once per column per pipeline run, never per cell (`rows` says
  which rows; when search formats a large column time-sliced, once per batch of rows). An
  interceptor on it (directly or through `on: '*'`) must set `hot: true`; without it, development
  reports `DK_HOT_INTERCEPTOR` with the measured cost (the interceptor still runs).
- `options.interceptors` is synced by `setOptions` (and by `useDataTable`): a new list recompiles
  the chains. Define interceptors outside components, like columns.

## Pitfalls

- **A slice or method name taken twice** throws at creation:
  [`DK_FEATURE_DUPLICATE`](../how-to-fix/errors.md#dk_feature_duplicate),
  [`DK_FEATURE_API_CONFLICT`](../how-to-fix/errors.md#dk_feature_api_conflict).
- **Mutating `indices`** or returning a plain array from `rowModel`:
  [`DK_FEATURE_MUTATED_INPUT`](../how-to-fix/errors.md#dk_feature_mutated_input),
  [`DK_FEATURE_BAD_OUTPUT`](../how-to-fix/errors.md#dk_feature_bad_output) (development); the step passes its
  input through.
- **A throwing `createApi`** leaves the feature's methods missing:
  [`DK_FEATURE_FAILED`](../how-to-fix/errors.md#dk_feature_failed).
- **`this` inside a nested object type** in a `FeatureTypes` interface is TS2526: hoist the state
  and API into generic types, as above.
- **`createTable<Item>({ features })` with only the row type given** turns off the inference of the
  features: let `T` be inferred from `data`, or spell out the feature tuple as the third type
  argument.
- **An interceptor on a hot operation** without `hot: true`:
  [`DK_HOT_INTERCEPTOR`](../how-to-fix/errors.md#dk_hot_interceptor). A throwing one:
  [`DK_INTERCEPTOR_FAILED`](../how-to-fix/errors.md#dk_interceptor_failed).
- **Emitting your own codes** needs a `defineDiagnostic` entry first; see
  [for plugin authors](../how-to-fix/errors.md#for-plugin-authors).

## See also

- [Features](features.md) — the built-in features, the preset and data modes.
- [State](state.md) — slices, `initialState` and controlled state, which apply to your feature too.
- [Diagnostics](diagnostics.md) — sinks, redaction and `explain()`.
- [Performance](performance.md) — why cell work goes through `column:batch`.
- [`@datakable/core` features](../../packages/core/README.md#features)
- [A custom feature: row selection](../examples/row-selection-feature.md) and [a logging
  interceptor](../examples/logging-interceptor.md) — recipes.
- [Examples](../examples/README.md)
