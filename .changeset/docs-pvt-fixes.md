---
'@datakable/core': patch
'datakable': patch
---

Documentation fixes from the 1.0.0 production validation (no code change):

- Next.js app router: import `datakable/messages` from a `'use client'` module rendered by the
  root layout; an import in `app/layout.tsx` (a server component) never reaches the browser.
  Fixes #15.
- `docs/examples/nextjs-ssr.md` and the SSR guide load the page's data inside `<Suspense>`, so
  the recipe builds with Next 16 `cacheComponents`. Fixes #17.
- Server mode: `filteredCount` and `totalCount` count the loaded page; keep the fetcher result's
  `rowCount` for the server's total (new "Counting rows in server mode" section). Fixes #31.
- `createTable<Row>({ features })` is a compile error, not silently un-inferred features; the
  printed error and its two fixes are in "Reading type errors" (section 7). Fixes #39.
- A server that is not bundled (Node, Nuxt/Nitro `node-server`) needs `NODE_ENV=production` at
  run time, or it reports in development mode with raw row keys. Fixes #47.
- Nuxt / Nitro drops a side-effect-only `import '@datakable/core/messages'` from the server
  bundle: install the text with `installMessages(...allMessages)` from a universal plugin.
  Fixes #48.
- `setOptions({ state })` replaces the whole `state` option: feed back every controlled slice.
  Fixes #49.
- A feature's option is reported at `feature "<name>"` with the option in `details.path`, not as
  `options.<feature>.<option>`. Fixes #50.
- SSR with `data` and an async `searchFn` for an initial query lists the rows unsearched
  (`data-status="pending"`), not the Loading state. Fixes #51.

Also documented: development freezes arrays passed as filter values; `setSorting` compares
entries as JSON (key order matters); zero-config search covers only string, number and boolean
columns (`DK_SEARCH_COLUMN_SKIPPED` otherwise).
