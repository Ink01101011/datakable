---
'@datakable/core': patch
'datakable': patch
---

Fix tables with features throwing `options.features is set but no feature runtime is loaded`
when the app is bundled with `esbuild --minify` (the documented production command). The feature
runtime is now installed by calling `defineFeature()` (every built-in feature does), not only by
a top-level statement that esbuild dropped after inlining `defineFeature` into its callers. This
covers `datakable`'s `createTable`, `useDataTable` and `<DataTable />` (default preset).
`pnpm size` now also runs every bundle it measures and fails when one does not work. Fixes #5.

New §9.3 size budgets (gzip, `pnpm size`) for the entries with features, set at the measured sizes
of bundles that now run: the earlier budgets were measured on bundles that threw (#5). Core +
`columnFilters` + `sorting` + `pagination` ≤ 24 KB (was 22 KB); `datakable` `createTable` ≤ 27 KB
(was 24.5 KB), `useDataTable` ≤ 28.5 KB (was 26.5 KB), `<DataTable />` ≤ 31.5 KB (was 29.5 KB).
Core `createTable` stays ≤ 15 KB.
