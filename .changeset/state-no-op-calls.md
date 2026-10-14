---
'@datakable/core': patch
---

Fix no-op `clearSorting()`, `setSorting(<the current sort>)`, `resetColumnFilters()` and
`setColumnFilter(id, <unchanged>)` calls creating a new slice and notifying subscribers (an extra
React / Vue render each). An unchanged sort (same ids and directions in the same order) or filter
set now keeps the slice reference and does not notify, like `setPageIndex` and `clearSearch` already
did. Fixes #21.
