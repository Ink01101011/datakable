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
