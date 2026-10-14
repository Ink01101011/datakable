---
'@datakable/core': patch
---

Fix the text of `DK_COLUMN_PATH_NOT_FOUND` when one row was checked or no key is close: it read
"does not exist in any of the first row" and the fix list started with "or compute the value".
It now reads "does not exist in the first row" ("in any of the first N rows" for more), and the
"or" is kept only after a suggested key. Fixes #44.
