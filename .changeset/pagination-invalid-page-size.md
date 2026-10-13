---
'@datakable/core': patch
---

Fix `pagination({ pageSize })` with `0`, `NaN`, a negative or a non-integer size in a production
build: the table no longer recurses until the stack overflows (`DK_INTERCEPTOR_FAILED`) and shows
0 rows. The invalid size is replaced by the default (10) and reported once as
`DK_INVALID_PAGINATION` (`where: { kind: 'feature', name: 'pagination' }`, with a fix when
`@datakable/core/messages` is installed). Development builds still throw `DK_INVALID_OPTION` at
creation. Fixes #13.
