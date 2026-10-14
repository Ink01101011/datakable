# Entry points

Every import path DataKable publishes, what each one brings, and which to use. The packages are
split so that a bundle contains only what you import: one entry per feature, and opt-in entries for
schema validation, the server source and async search.

## Packages

| Package | Use it when | Default features |
| --- | --- | --- |
| `datakable` | any app that wants the default preset; React on `datakable/react` | `columnFilters`, `validity`, `search`, `sorting`, `pagination` |
| `@datakable/react` | React apps that choose every feature | none |
| `@datakable/core` | no React, or your own bindings | none |

The three are released together with one version; install versions that match (development
builds report a mismatch as [`DK_VERSION_MISMATCH`](../how-to-fix/errors.md#dk_version_mismatch)).

TypeScript resolves every subpath below under `moduleResolution` `bundler`, `node16` / `nodenext`
and the legacy `node10` (`node`), through `exports` and a `typesVersions` fallback; the stylesheet
exports carry an empty declaration, so `import 'datakable/styles.css'` type-checks too.

## `datakable`

| Import | What it brings |
| --- | --- |
| `datakable` | Framework-free: `createTable` that installs the default preset when you pass no `features`, plus everything exported by `@datakable/core` (features, `withSchema`, `withFetcher`, `withSearchFn`, `createDeferred`, `startTable`, types). Imports no React. |
| `datakable/react` | Everything `datakable` exports, plus `useDataTable` and `<DataTable />` that install the default preset, and the rest of `@datakable/react` (prop and component types, `renderMessages`, …). Needs React. |
| `datakable/core` | `@datakable/core` unchanged: its `createTable` installs no features by default. |
| `datakable/messages` | A side-effect import: the full diagnostic text in production builds, for core and React codes. Imports no React. |
| `datakable/styles.css` | The optional stylesheet for `<DataTable />`. |

`react` is an optional peer dependency: `datakable`, `datakable/core` and `datakable/messages`
work without React installed, also in plain Node.js with `--conditions=react-server`. Only the
modules of `useDataTable` and `<DataTable />` carry a `"use client"` directive, so the rest of
`datakable/react` also works in server code (through a bundler), and a bundle that uses only
`createTable` contains no React. Call `useDataTable` from a client component in the Next.js app
router ([Getting started](getting-started.md#nextjs-app-router)).

### Migrating from 1.x

2.0 moved the React API of `datakable` to `datakable/react` (#63); `@datakable/core` and
`@datakable/react` moved to 2.0.0 with it (one version for the three packages) and their imports
are unchanged. In a React app, import the hook, the component and their types from
`datakable/react`:

```diff
- import { DataTable, useDataTable, type DataTableProps } from 'datakable'
+ import { DataTable, useDataTable, type DataTableProps } from 'datakable/react'
```

`datakable/react` also exports everything the root does, so replacing `'datakable'` with
`'datakable/react'` in every import of a React app is enough. The names that left the root are
`useDataTable`, `DataTable`, `UseDataTableOptions`, `UseDataTableResult`, `DataTableProps`,
`DataTableOwnProps`, `DataTableSource`, `DataTableComponents`, `SearchInputProps`,
`PaginationProps`, `EmptyProps`, `LoadingProps`, `ErrorProps`, `cellSlot`, `invalidCellSlot`,
`reactDiagnostics`, `renderDiagnostics` and `renderMessages`; importing one of them from
`datakable` is a TypeScript error (`Module '"datakable"' has no exported member 'useDataTable'`).
`createTable`, the features, `datakable/core`, `datakable/messages` and `datakable/styles.css`
are unchanged.

## `@datakable/react`

| Import | What it brings |
| --- | --- |
| `@datakable/react` | `useDataTable` and `<DataTable />` with no features unless you pass them, their prop and component types (`DataTableComponents`, `SearchInputProps`, …), and everything exported by `@datakable/core`. The `<DataTable />` and `useDataTable` modules are marked `"use client"`; the rest also works in server code. |
| `@datakable/react/styles.css` | The same optional stylesheet. |
| `@datakable/react/messages` | A side-effect import: the full diagnostic text in production builds, for core and React codes (what `datakable/messages` installs). Imports no React. |

With `@datakable/react`, `import '@datakable/react/messages'` keeps the text of core's codes and of
the React codes (`renderMessages`) in production; `import '@datakable/core/messages'` keeps core's
only.

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
| `@datakable/core/messages` | A side-effect import: the full text of core's diagnostics in production builds. Also exports `allMessages`, for `installMessages(...allMessages)` where a bundler drops side-effect imports (Nuxt / Nitro). |

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

Each wrapper is also exported by `@datakable/core`, `datakable` and `datakable/react`. An unwrapped value is a compile
error, and throws [`DK_INVALID_OPTION`](../how-to-fix/errors.md#dk_invalid_option) in every build.

## Pitfalls

- **Two copies of `@datakable/core`** in one bundle (for example, mismatched versions installed
  side by side) break the shared registry and double the size; development builds report
  [`DK_DUPLICATE_CORE`](../how-to-fix/errors.md#dk_duplicate_core). Deduplicate the dependency.
  One version loaded twice (its ESM and CJS builds, a Next.js dev server's layers) is only an
  info:
  [`DK_DUPLICATE_CORE_SAME_VERSION`](../how-to-fix/errors.md#dk_duplicate_core_same_version).
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
