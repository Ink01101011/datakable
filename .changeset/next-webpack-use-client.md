---
'@datakable/react': patch
'datakable': patch
---

Fix `next build --webpack` (and `next dev --webpack`) failing with `It's currently unsupported to
use "export *" in a client boundary` when a server component imports `@datakable/react`,
`createTable` from `datakable`, or `datakable/messages` in `app/layout.tsx`. `"use client"` is now
only on the modules of `<DataTable />` and `useDataTable`, not on `@datakable/react`'s index, so
`<DataTable />` imported from a server component is still a client component and core's exports
(`createTable`, …) stay callable on the server. `pnpm check:pkg` now loads the built entries as a
React server module and fails where Next's webpack build would. Fixes #8.
