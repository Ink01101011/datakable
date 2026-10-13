---
'datakable': patch
---

Fix `createTable` from `datakable` bringing React along: the package was one file, so a bundle
that used only `createTable` still contained React (and kept `import 'react'` with React external),
a Next.js server component that only called `createTable` shipped about 19 KB gzip of table code
to the browser (Turbopack), and `<DataTable />` from `datakable` in a server component failed the
build with `(0 , e.useRef) is not a function`. `datakable` is now published one file per module,
like `@datakable/core` and `@datakable/react`, and only the modules of `<DataTable />` and
`useDataTable` are marked `"use client"`: a `createTable`-only bundle has no React, a server
component can render `<DataTable />` with plain data props, and `useDataTable` called on the
server gets Next's `Attempted to call useDataTable() from the server`. The public imports are
unchanged. `pnpm check:pkg` now loads `datakable` as a React server module and bundles
`createTable` alone, and fails if React is in that bundle. Fixes #9.
