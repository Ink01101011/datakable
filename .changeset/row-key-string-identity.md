---
'@datakable/core': patch
---

`rowKey`: keys are now compared as strings, the identity React keys and `explainRow` use, so `1`
and `'1'` are a duplicate: the later row gets `1#1` and `DK_DUPLICATE_ROW_KEY` is reported
(before, both rows kept their keys and `<DataTable>` rendered two rows with the same React key).
Fields suggested by the fix are checked the same way. Fixes #24.
