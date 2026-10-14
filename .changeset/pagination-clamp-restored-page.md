---
'@datakable/core': patch
---

Fix a restored `pagination.pageIndex` past the last page (`initialState` / controlled `state`)
staying in the state: the table showed the last page while `getState().pagination.pageIndex` kept
the restored value, so a pager built from the state read "Page 100 of 3". The index is now clamped
at creation against the data (server mode: a known `rowCount`), without running the pipeline early;
restored filters that leave fewer rows are clamped on the first update as before. Fixes #19.
