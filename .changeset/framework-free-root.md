---
"datakable": major
"@datakable/react": minor
---

**Breaking:** the `datakable` root entry is framework-free; the React API moved to `datakable/react` (Fixes #63).

- `datakable` exports `createTable` with the default preset and everything from `@datakable/core`. It imports no React, so `import 'datakable'` (and `datakable/core`, `datakable/messages`) works in a project without React installed, and in plain Node.js with `--conditions=react-server`.
- `datakable/react` (new) exports everything `datakable` does, plus `useDataTable` and `<DataTable />` with the default preset and the rest of `@datakable/react`. Only the hook and component modules are `"use client"`, as before.
- `react` is now an optional peer dependency of `datakable` and `@datakable/react` (`peerDependenciesMeta`), so npm and pnpm no longer install React for a project that only uses the framework-free entries.
- `@datakable/react/messages` (new): the production diagnostic text of core and `<DataTable />`, without importing React. `datakable/messages` now uses it.

`core`, `react` and `datakable` are one fixed version group, so this major bump releases all three as 2.0.0. `@datakable/core` and `@datakable/react` keep their imports; only `datakable`'s React imports change.

**Migration:** in a React app, import the hook, the component and their types from `datakable/react`. It is a superset of the root, so replacing `from 'datakable'` with `from 'datakable/react'` in every import is enough:

```diff
- import { DataTable, useDataTable, type DataTableProps } from 'datakable'
+ import { DataTable, useDataTable, type DataTableProps } from 'datakable/react'
```

Names that left the root: `useDataTable`, `DataTable`, `UseDataTableOptions`, `UseDataTableResult`, `DataTableProps`, `DataTableOwnProps`, `DataTableSource`, `DataTableComponents`, `SearchInputProps`, `PaginationProps`, `EmptyProps`, `LoadingProps`, `ErrorProps`, `cellSlot`, `invalidCellSlot`, `reactDiagnostics`, `renderDiagnostics`, `renderMessages`. Full note: docs/how-to-use/entry-points.md#migrating-from-1x.
