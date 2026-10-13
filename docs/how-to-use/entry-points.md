# Entry points

Every import path DataKable publishes, what each one brings, and which to use. The packages are
split so that a bundle contains only what you import: one entry per feature, and opt-in entries for
schema validation, the server source and async search.

## Packages

| Package | Use it when | Default features |
| --- | --- | --- |
| `datakable` | React apps that want the default preset | `columnFilters`, `validity`, `search`, `sorting`, `pagination` |
| `@datakable/react` | React apps that choose every feature | none |
| `@datakable/core` | no React, or your own bindings | none |

The three are released together with one version; install versions that match (development
builds report a mismatch as [`DK_VERSION_MISMATCH`](../how-to-fix/errors.md#dk_version_mismatch)).

## `datakable`

| Import | What it brings |
| --- | --- |
| `datakable` | `createTable`, `useDataTable` and `<DataTable />` that install the default preset when you pass no `features`, plus everything exported by `@datakable/react` and `@datakable/core` (features, `withSchema`, `withFetcher`, `withSearchFn`, `createDeferred`, `startTable`, types). |
| `datakable/core` | `@datakable/core` unchanged: its `createTable` installs no features by default. |
| `datakable/messages` | A side-effect import: the full diagnostic text in production builds, for core and React codes. |
| `datakable/styles.css` | The optional stylesheet for `<DataTable />`. |

Only the modules of `useDataTable` and `<DataTable />` carry a `"use client"` directive, so
`createTable` and the rest also work in server code, and a bundle that uses only `createTable`
contains no React. Call `useDataTable` from a client component in the Next.js app router
([Getting started](getting-started.md#nextjs-app-router)).

## `@datakable/react`

| Import | What it brings |
| --- | --- |
| `@datakable/react` | `useDataTable` and `<DataTable />` with no features unless you pass them, their prop and component types (`DataTableComponents`, `SearchInputProps`, …), and everything exported by `@datakable/core`. The `<DataTable />` and `useDataTable` modules are marked `"use client"`; the rest also works in server code. |
| `@datakable/react/styles.css` | The same optional stylesheet. |

With `@datakable/react`, `import '@datakable/core/messages'` keeps the text of core's codes in
production; the text of the React codes (`renderMessages`) is installed by `datakable/messages`, or
by `installMessages(renderMessages)` from `@datakable/react`.

## `@datakable/core`

| Import | What it brings |
| --- | --- |
| `@datakable/core` | `createTable` (no features by default), every feature, `defaultFeatures` / `createDefaultFeatures`, the opt-in wrappers, `createDeferred` / `startTable`, `defineFeature`, `defineOptions`, `defineInterceptor`, `tracer`, the error classes and every type. |
| `@datakable/core/column-filters` | `columnFilters()` and its types. |
| `@datakable/core/validity` | `validity()` and its types. |
| `@datakable/core/search` | `search()`, its types and `withSearchFn`. |
| `@datakable/core/sorting` | `sorting()` and its types. |
| `@datakable/core/pagination` | `pagination()` and its types. |
| `@datakable/core/schema` | `withSchema()`, `DatakableSchemaError` and the Standard Schema types: schema validation ([Schema validation](schema-validation.md)). |
| `@datakable/core/server` | `withFetcher()` and the fetcher types: the server source ([Server mode](server-mode.md)). |
| `@datakable/core/search-async` | `withSearchFn()` and the `searchFn` types: the async search engine ([Search](search.md)). |
| `@datakable/core/messages` | A side-effect import: the full text of core's diagnostics in production builds. |

The JavaScript is published one file per source module and marked side-effect free (except the
`messages` entries and the stylesheets), so a bundler keeps only what you use, whichever entry you
import it from. The per-feature entries make it explicit which parts a module uses.

```ts
import { createTable, type FetchParams, type FetchResult } from '@datakable/core'
import { pagination } from '@datakable/core/pagination'
import { withFetcher } from '@datakable/core/server'
import { sorting } from '@datakable/core/sorting'

type User = { id: number; name: string }
declare function fetchUsers(params: FetchParams): Promise<FetchResult<User>>

// Each import brings one part: the bare table, two features and the server source. Search,
// filters, schema validation and the async search engine are not bundled.
const table = createTable({
  rowKey: 'id',
  features: [sorting({ mode: 'server' }), pagination({ mode: 'server', pageSize: 20 })],
  fetcher: withFetcher(fetchUsers),
})
table.toggleSort('name')
```

## Opt-in wrappers

Three options take a value wrapped by a function from its own entry. The wrapper carries the
machinery the option needs, so a table that does not use the option does not bundle it:

| Option | Wrapper | Entry |
| --- | --- | --- |
| `schema` | `withSchema(UserSchema)` | `@datakable/core/schema` |
| `fetcher` | `withFetcher(fetchUsers)` | `@datakable/core/server` |
| `search({ searchFn })` | `withSearchFn(searchUsers)` | `@datakable/core/search-async` |

Each wrapper is also exported by `@datakable/core` and `datakable`. An unwrapped value is a compile
error, and throws [`DK_INVALID_OPTION`](../how-to-fix/errors.md#dk_invalid_option) in every build.

## Pitfalls

- **Two copies of `@datakable/core`** in one bundle (for example, mismatched versions installed
  side by side) break the shared registry and double the size; development builds report
  [`DK_DUPLICATE_CORE`](../how-to-fix/errors.md#dk_duplicate_core). Deduplicate the dependency.
- **`createTable` from `@datakable/core` or `datakable/core` has no features**: `toggleSort` and the
  other feature methods do not exist until you pass `features` (or `defaultFeatures`).
- **Importing `datakable/messages` everywhere** adds the full message text to your production
  bundle. Import it once, in the app entry, and only if you want the text in production.

## See also

- [Getting started](getting-started.md) — which package to install.
- [Features](features.md) — choosing features.
- [Performance](performance.md) — bundle budgets and keeping bundles small.
- [`datakable` README: entry points](../../packages/datakable/README.md#entry-points)
- [The bundle is too big](../how-to-fix/bundle-too-big.md) and [`process is not
  defined`](../how-to-fix/process-is-not-defined.md) — troubleshooting.
