---
'@datakable/core': patch
---

Fix `setSearch()` / `flushSearch()` resolving `{ status: 'applied' }` while the row model was
still `'pending'` (unfiltered) on large data, where the built-in search builds its index and
matches in time slices. The promise now resolves `'applied'` once a row model that reflects the
query has been computed (status no longer `'pending'`), and `'superseded'` when a newer query,
`cancelSearch()` or `destroy()` interrupts that work. Fixes #6.
