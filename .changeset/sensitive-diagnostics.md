---
"@datakable/core": patch
"@datakable/react": patch
"datakable": patch
---

Diagnostics privacy: a `rowKey` that is (or points into) a `sensitive: true` column is now logged as `[sensitive]` at every level instead of a short hash, since a 32-bit hash of an SSN or email can be recovered by trying candidates. `context.cause` (the original thrown error, which can quote row values) now reaches `onDiagnostic` and the `strict` `DatakableError` only: `getDiagnostics()` returns diagnostics without it, as the docs already promised.
