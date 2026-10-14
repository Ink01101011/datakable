---
'@datakable/core': patch
---

Column paths and `rowKey` paths no longer read inherited `Object.prototype` members: a key such as
`constructor`, `toString` or `__proto__` (or an inherited method like an array's `map`) reads
`undefined` unless the row has it as its own property, so `DK_COLUMN_PATH_NOT_FOUND` /
`DK_MISSING_ROW_KEY` are reported instead of a function being shown as a value. Class getters
still work. Fixes #42.
