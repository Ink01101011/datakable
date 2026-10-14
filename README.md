# DataKable

Type-safe generic data table for React: zero-config by default, headless when you need it.

- **One line to a working table.** `useDataTable({ data })` sorts, filters, searches and paginates,
  with columns derived from the data.
- **Type safety is the product.** Column keys are dot-paths of your row type; a typo, a `range`
  filter on a string column or an object column without a renderer is a compile error.
- **Never silent.** Every problem becomes a diagnostic with a stable `DK_*` code, the exact
  location (column, option or row), what the table did instead, and a concrete fix. The table keeps
  working on the last good snapshot. `explain()` / `explainRow(key)` answer "where did my rows go?".
- **Pay for what you use.** One entry per feature, an index-based pipeline, and development-only
  checks and message text stripped from production builds.

> Version 1.0: the public API is stable and follows semantic versioning from here. Guides,
> examples and troubleshooting live in the [documentation](docs/README.md); the design is in the
> [design spec](docs/superpowers/specs/2026-10-12-core-api-design.md).

## Quick start

```bash
npm install datakable react
```

Requires React `>=18`; the types need TypeScript `>=5.4`; in Node.js (SSR, tests), Node `>=18.18`.

```tsx
import { useDataTable } from 'datakable'

type User = { id: number; name: string; age: number; city: string }

export function Users({ users }: { users: User[] }) {
  // Zero-config: columns come from the data; sorting, filters, search and pagination are on.
  const table = useDataTable({ data: users, rowKey: 'id' })
  const { rows, filteredCount, status, isInitialLoad } = table.rowModel

  if (status === 'error' && isInitialLoad) return <p>Could not load users.</p>
  return (
    <section data-status={status}>
      <input
        value={table.state.search.input}
        onChange={(e) => void table.setSearch(e.target.value)}
        placeholder="Search"
      />
      <table>
        <thead>
          <tr>
            <th aria-sort={table.getSortDirection('name') === 'desc' ? 'descending' : 'none'}>
              <button type="button" onClick={() => table.toggleSort('name')}>
                Name
              </button>
            </th>
            <th>Age</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.original.name}</td>
              <td>{row.original.age}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>{filteredCount} users</p>
      <button type="button" disabled={!table.canPrevPage()} onClick={table.prevPage}>
        Previous
      </button>
      <button type="button" disabled={!table.canNextPage()} onClick={table.nextPage}>
        Next
      </button>
    </section>
  )
}
```

The default preset is `columnFilters`, `validity`, `search`, `sorting` and `pagination`. Pass
`features` to choose your own; see [`@datakable/core`](packages/core/README.md) for columns,
schema validation, server mode, the status model, diagnostics and `explain()`.

**Bundler requirement:** DataKable reads `process.env.NODE_ENV` to strip development-only code. Vite,
webpack, Next.js, Rollup (with `@rollup/plugin-replace`) and esbuild (`--define`) all replace it.
Without a replacement, unbundled browser code throws `ReferenceError: process is not defined`, as
React and Redux do.

**Next.js app router:** only the modules of `<DataTable />` and `useDataTable` are marked
`"use client"`, so `createTable` also works on the server and a server component can render
`<DataTable />` with plain data props. Call `useDataTable`, or pass functions (cells, features, a
fetcher), from a client component (a `'use client'` file).

## Packages

| Package | Path | Purpose |
| --- | --- | --- |
| [`datakable`](packages/datakable/README.md) | `packages/datakable` | Main entry: `useDataTable` / `createTable` with the default preset; `datakable/core`, `datakable/messages` |
| [`@datakable/react`](packages/react/README.md) | `packages/react` | `useDataTable` hook (`"use client"` modules), no features by default |
| [`@datakable/core`](packages/core/README.md) | `packages/core` | Headless, framework-agnostic table: store, features, diagnostics. No React |
| `@datakable/docs` | `apps/docs` | Vite playground (private) |

`core`, `react` and `datakable` are released together with one version (Changesets fixed group).

## Development

Requires Node `>=22.12` and pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm docs          # playground, resolves packages from source (HMR)
pnpm dev           # tsup --watch for all packages
pnpm test          # vitest: unit + type tests (*.test-d.ts), runs on source
pnpm build         # tsup → dual ESM/CJS + .d.ts/.d.cts
pnpm typecheck     # per-package tsc (needs `pnpm build` first — packages resolve each other via dist)
pnpm lint          # biome
pnpm check:pkg     # publint --strict + are-the-types-wrong + catalog + consumer type check
```

## Conventions

- **Build**: tsup, `format: ['esm','cjs']`, `exports` map with per-condition `types`, `sideEffects: false` (except `messages`).
- **TypeScript**: pinned to `~6.0`. TS 7 (native port) has no JS compiler API yet, which tsup's dts build needs.
- **Type tests**: put them in `*.test-d.ts` and use `expectTypeOf`. They are first-class, because type-safety is the product.
- **README examples**: every `ts` / `tsx` block in a README is a file in
  `packages/datakable/src/readme-examples/`, compiled by `pnpm typecheck`; `readme-examples.test.ts`
  fails when a README block and the files differ.
- **Versioning**: Changesets with a **fixed** group, so core/react/datakable always share one version.

## Releasing

1. `pnpm changeset` → describe the change → commit.
2. On `main`, the Release workflow opens a "Version Packages" PR; merging it publishes to npm.
3. Publishing uses **npm Trusted Publishing (OIDC)** with provenance, so no `NPM_TOKEN` secret is needed.
   Configure it per package on npmjs.com → Settings → Trusted Publisher (GitHub Actions, workflow `release.yml`).
   Each package must exist on npm first, so do the first publish of `@datakable/core` / `@datakable/react` manually with `--access public`.

## License

MIT © Supakit Kitjanabumrungsak
