---
'@datakable/core': patch
---

`rowKey`: a generated fallback key (`key#n` for a duplicate, `#index` for a missing key) no longer
takes the real, unique key of a later row. Keys are now assigned in two passes: every real key
first, then the fallbacks, which skip every taken key. Data ids `['1', '1', '1#1']` now get keys
`['1', '1#2', '1#1']`, and `explainRow('1#1')` finds the row whose key really is `'1#1'`. Fixes #29.
