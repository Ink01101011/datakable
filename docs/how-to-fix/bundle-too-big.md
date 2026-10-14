# The bundle is too big

DataKable adds more to your bundle than you expected. Most of the size is the features you
install and development code that a production build should remove.

## Confirm: what is bundled?

- **Is it a production build?** Development code (option validation, data and version checks,
  the tracer, every message text) is removed only when the bundler replaces
  `process.env.NODE_ENV` with `"production"`. Vite, webpack, Next.js, Rollup with
  `@rollup/plugin-replace` and esbuild with `--define` do; see
  [`process is not defined`](process-is-not-defined.md).
- **Which features?** `datakable`'s `createTable`, `useDataTable` and `<DataTable />` install the
  whole preset when you pass no `features`: column filters, validity, search (with its fuzzy
  search engine) and sorting and pagination.
- Use your bundler's analyser (for example `rollup-plugin-visualizer`, `source-map-explorer`, or
  esbuild's `--metafile`) to see the share of `@datakable/*`, `ex-search`, `exsorted` and
  `kk-debounce`.

For reference, CI holds DataKable's own code (minified + gzip, production, without its
dependencies and React) to these budgets:

| Import | Budget |
|---|---|
| `@datakable/core`: `createTable` | ≤ 15 KB |
| `@datakable/core`: `createTable` + `columnFilters` + `sorting` + `pagination` | ≤ 24 KB |
| `datakable`: `createTable` (default preset) | ≤ 27 KB |
| `datakable`: `useDataTable` (default preset) | ≤ 28.5 KB |
| `datakable`: `<DataTable />` (default preset) | ≤ 32.5 KB |

The dependencies add about 3.7 KB for search (`ex-search`), 0.8 KB for search typing
(`kk-debounce`) and 1.2–2.4 KB for sorting (`exsorted`), gzip.

## Fix: install only what you use

Pass `features` to install a subset of the preset; the others, and their dependencies, are not
bundled:

```tsx
import { DataTable, pagination, sorting } from 'datakable'

type User = { id: number; name: string; age: number }

// `features` replaces the default preset: no search (and its search engine), no column filters.
const features = [sorting(), pagination({ pageSize: 25 })]

export function Users({ users }: { users: User[] }) {
  return <DataTable data={users} rowKey="id" features={features} />
}
```

For the smallest bundle, use `@datakable/core` directly (and `@datakable/react` for the hook),
which install no features unless you pass them, and import each feature from its own entry:

```ts
// `npm install @datakable/core`: the headless core, one entry per feature. Only what you import
// is bundled — here the table, sorting and pagination; no search engine, no filters.
import { createTable } from '@datakable/core'
import { pagination } from '@datakable/core/pagination'
import { sorting } from '@datakable/core/sorting'

type User = { id: number; name: string; age: number }
declare const users: User[]

export const table = createTable({
  data: users,
  rowKey: 'id',
  features: [sorting(), pagination({ pageSize: 25 })],
})
```

## Other things that add size

- `import 'datakable/messages'` adds every diagnostic's text to production; import it only if
  you read diagnostics in production
  ([diagnostics without text](diagnostics-without-text-in-production.md)).
- `withSchema`, `withFetcher` and `withSearchFn` bring validation, the server source and the async
  search engine; a table without them does not bundle them.
- `datakable/styles.css` is optional (about 1 KB gzip).
- Two copies of `@datakable/core` in one page ship core twice, and plugins built against the
  other copy may be ignored: [`DK_DUPLICATE_CORE`](errors.md#dk_duplicate_core) (development).
  Keep `datakable`, `@datakable/react` and `@datakable/core` at one version, deduplicated.

## Related codes

[`DK_DUPLICATE_CORE`](errors.md#dk_duplicate_core) ·
[`DK_VERSION_MISMATCH`](errors.md#dk_version_mismatch)

## See also

- [`datakable` entry points](../../packages/datakable/README.md#entry-points)
- [`@datakable/core` features](../../packages/core/README.md#features)
- Guides: [entry points](../how-to-use/entry-points.md),
  [performance](../how-to-use/performance.md).
- [How to fix](README.md) — every symptom.
