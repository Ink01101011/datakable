# DataKable documentation

DataKable is a type-safe generic data table for React: zero-config by default, headless when you
need it. `useDataTable({ data })` sorts, filters, searches and paginates, with columns derived from
the data; column keys are dot-paths of your row type, so a typo is a compile error; and every
problem becomes a diagnostic with a stable `DK_*` code, the exact location and a concrete fix. This
is the central index of the docs for version 1.0: every guide, example and troubleshooting page is
linked from here.

## Start here

1. [Getting started](how-to-use/getting-started.md) — install, render a zero-config table, and
   meet the bundler requirement.
2. [A zero-config table from an array](examples/zero-config.md) — the same in a complete recipe.
3. [Core concepts](how-to-use/core-concepts.md) — the table, the pipeline, the row model and the
   status model, which every other page builds on.
4. [React](how-to-use/react.md) or [Columns and row keys](how-to-use/columns-and-row-keys.md) —
   then the guide for whatever you need next, below.
5. When the console prints a `DK_*` code or TypeScript rejects a column:
   [How to fix](how-to-fix/README.md).

## How to use

Guides, one part of the API per page ([section index](how-to-use/README.md)).

- Basics: [Getting started](how-to-use/getting-started.md) ·
  [Core concepts](how-to-use/core-concepts.md) · [State](how-to-use/state.md) ·
  [Columns and row keys](how-to-use/columns-and-row-keys.md)
- Features: [Features](how-to-use/features.md) · [Column filters](how-to-use/column-filters.md) ·
  [Search](how-to-use/search.md) · [Sorting](how-to-use/sorting.md) ·
  [Pagination](how-to-use/pagination.md) · [Validity](how-to-use/validity.md)
- Data: [Server mode](how-to-use/server-mode.md) ·
  [Schema validation](how-to-use/schema-validation.md)
- React and rendering: [React](how-to-use/react.md) ·
  [Server rendering (SSR)](how-to-use/ssr.md)
- Debugging and extending: [Diagnostics](how-to-use/diagnostics.md) ·
  [Custom features and interceptors](how-to-use/custom-features-and-interceptors.md) ·
  [Performance](how-to-use/performance.md) · [Entry points](how-to-use/entry-points.md)

## Examples

Complete recipes, each compiled and run by a test ([section index](examples/README.md)).

- On screen: [A zero-config table](examples/zero-config.md) ·
  [Custom columns](examples/custom-columns.md) ·
  [A headless table](examples/headless-table.md) · [Theming](examples/theming.md)
- Server data: [A server-side table](examples/server-side-table.md) ·
  [Search through an API](examples/async-search.md) ·
  [Server rendering with Next.js](examples/nextjs-ssr.md)
- State and data quality: [Validate rows with a schema](examples/schema-validation.md) ·
  [State in the URL](examples/url-state.md) · [Large data](examples/large-data.md)
- Extending: [A custom feature: row selection](examples/row-selection-feature.md) ·
  [A logging interceptor](examples/logging-interceptor.md) ·
  [Report diagnostics to an error tracker](examples/error-reporting.md)

## How to fix

Troubleshooting by symptom, by `DK_*` code and by type error
([section index](how-to-fix/README.md)).

- Reference: [Diagnostics reference](how-to-fix/errors.md) (every `DK_*` code) ·
  [Reading type errors](how-to-fix/reading-type-errors.md)
- Rows and features: [The table shows no rows](how-to-fix/no-rows.md) ·
  [Sorting or filtering does nothing](how-to-fix/sorting-or-filtering-does-nothing.md) ·
  [Search finds nothing, or is slow](how-to-fix/search-finds-nothing-or-is-slow.md)
- React and SSR: [Endless re-renders or a frozen page](how-to-fix/endless-re-renders.md) ·
  [SSR and hydration problems](how-to-fix/ssr-and-hydration.md)
- Server data: [The loading state never ends](how-to-fix/loading-never-ends.md) ·
  [Fetch errors and retries](how-to-fix/fetch-errors-and-retries.md) ·
  [`DK_INVALID_OPTION` for `schema`, `fetcher` or `searchFn`](how-to-fix/unwrapped-schema-fetcher-or-searchfn.md)
- Builds and production: [The bundle is too big](how-to-fix/bundle-too-big.md) ·
  [`process is not defined`](how-to-fix/process-is-not-defined.md) ·
  [Diagnostics have no text in production](how-to-fix/diagnostics-without-text-in-production.md) ·
  [Memory and speed with many rows](how-to-fix/large-data.md)

The diagnostics reference and the type-error guide used to live at `docs/errors.md` and
`docs/reading-type-errors.md`; those addresses stay as pointer pages, because every diagnostic's
`docs` URL links to `docs/errors.md#<code>`.

## Package reference

Each package README is the API reference for that package:

- [`datakable`](../packages/datakable/README.md) — the main entry: `useDataTable`, `createTable`
  and `<DataTable />` with the default feature preset.
- [`@datakable/react`](../packages/react/README.md) — the React bindings, with no features unless
  you pass them.
- [`@datakable/core`](../packages/core/README.md) — the headless, framework-agnostic table store,
  features, diagnostics and `explain()`.

DataKable follows semantic versioning from 1.0: a breaking change to the public API, including a
`DK_*` code's meaning, ships only in a new major version. `core`, `react` and `datakable` always
share one version.

## Contributing to the docs

Two tests keep these pages true; both pick up new pages and files with no registration.

- **Code is compiled.** Every ` ```ts ` / ` ```tsx ` block of a page under `docs/` (not
  `docs/superpowers/`) is a file of `packages/datakable/src/docs-examples/`, which
  `pnpm typecheck` compiles against the built packages. The n-th TypeScript block of
  `docs/<section>/<page>.md` is the file `docs-examples/<section>/<page>/<n>-<slug>.ts` (or
  `.tsx`), and the block's text is exactly the file's text. A file no block shows fails the test,
  except helpers: files or folders whose name starts with `_` (shared sample data, for instance)
  may be imported by examples without being shown.
  `packages/datakable/src/docs-examples.test.ts` checks this.
- **Links resolve.** Every relative link in `docs/` and in the four READMEs must point to an
  existing file, and a `#anchor` to a heading of the target page (GitHub's rules: lower case,
  punctuation removed, spaces become `-`). Every page must be reachable from this index.
  `packages/datakable/src/docs-links.test.ts` checks this.

To add a page:

1. Write `docs/<section>/<page>.md`: a title, one paragraph on what the page is for, the body
   sections, and a "See also" list of links. English, in the voice of the READMEs.
2. Write each TypeScript block as `packages/datakable/src/docs-examples/<section>/<page>/<n>-<slug>.ts(x)`
   first, run `pnpm build && pnpm typecheck`, then paste the file into the page as-is. Describe
   only the API that exists: read the source and the package exports.
3. Show console or other output in a ` ```text ` block only when a test checks it against what
   DataKable prints (as `errors-doc.test.tsx` does for [the diagnostics reference](how-to-fix/errors.md));
   otherwise leave it out. Shell commands go in ` ```sh ` blocks, which are not compiled.
4. Link the page from its section's `README.md`.
5. Run `pnpm test`: the drift and link tests run with the other tests.

A block that must show a type error is still a compiled file: write it as a complete example with
`// @ts-expect-error` on the failing line, so the error itself is checked.
