---
'@datakable/core': patch
'@datakable/react': patch
'datakable': patch
---

- Types: with `strict: false` (precisely `strictNullChecks: false`), `createTable({ data: users, rowKey: 'id' })` and `useDataTable({ data: users, rowKey: 'id' })` no longer fail with TS2322. Without `strictNullChecks`, `undefined` (the "no schema" default) was assignable to `TableSchema`, so every table looked like it had a schema: `data` was typed `unknown[]` and the row type collapsed to `unknown`. The schema check now excludes `undefined` explicitly; `strict: true` inference is unchanged. `check:consumer` now also compiles a `strict: false` consumer, with and without `strictNullChecks`. (#93)
