# DataKable documentation

DataKable is a type-safe generic data table for React: zero-config by default, headless when you
need it. `useDataTable({ data })` sorts, filters, searches and paginates, with columns derived from
the data; column keys are dot-paths of your row type, so a typo is a compile error; and every
problem becomes a diagnostic with a stable `DK_*` code, the exact location and a concrete fix. This
is the central index of the docs for version 1.0: every guide, example and troubleshooting page is
linked from here.

## Sections

- **[How to use](how-to-use/README.md)** — guides: install DataKable, then learn one part of the
  API per page (columns, features, server data, state, SSR, diagnostics).
- **[Examples](examples/README.md)** — a cookbook: complete, compiled recipes for common tables
  you can copy into your app.
- **[How to fix](how-to-fix/README.md)** — troubleshooting: what a `DK_*` diagnostic or a type
  error means, and how to fix it.

## Start here

1. Install and render your first table: the [quick start](../README.md#quick-start) in the main
   README.
2. Pick the guide for what you need next in [How to use](how-to-use/README.md).
3. Copy a recipe close to your use case from [Examples](examples/README.md).
4. When the console prints a `DK_*` code or TypeScript rejects a column, look it up in
   [How to fix](how-to-fix/README.md).

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
   DataKable prints (as `errors-doc.test.tsx` does for [the diagnostics reference](errors.md));
   otherwise leave it out. Shell commands go in ` ```sh ` blocks, which are not compiled.
4. Link the page from its section's `README.md`.
5. Run `pnpm test`: the drift and link tests run with the other tests.

A block that must show a type error is still a compiled file: write it as a complete example with
`// @ts-expect-error` on the failing line, so the error itself is checked.
