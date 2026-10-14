---
'@datakable/core': patch
---

Fix a `strict: true` table showing 0 rows with status `'idle'` after `getRowModel()` threw (for
example `DK_DUPLICATE_ROW_KEY`): the throw left the run before the row model was committed. The
run now commits the same fallback as any failed run: the last good rows (or none on the first
run) with status `'error'`. Fixes #43.
