---
'@datakable/react': patch
---

A custom `components.SearchInput` or `components.Pagination` that throws no longer unmounts the
whole React root: `<DataTable />` renders the default part in its place (still bound to the table)
until another component is passed, and reports `DK_RENDER_FAILED` (`render:table` at
`components.SearchInput` / `components.Pagination`). Fixes #26.
