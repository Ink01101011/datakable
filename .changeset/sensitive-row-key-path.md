---
'@datakable/core': patch
---

Privacy: a `rowKey` path that points into a `sensitive` column (`rowKey: 'contact.email'` with
column `contact` sensitive), or contains one, now hashes row keys in every diagnostic,
`toJSON()`, the console text and `explainRow().key`, at every redaction level. Before, only an
exact match (`rowKey` equal to the sensitive column's key) was recognised, so the raw key (an
e-mail address) was logged under the development default and under `'keys'` / `'full'`. Values
of a column inside a sensitive column are now `[sensitive]` as well. Fixes #45.
