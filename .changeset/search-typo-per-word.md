---
'@datakable/core': patch
---

Fix the built-in search never matching a typo against one word of a multi-word cell
(`lopes` → `Garcia Lopez`, `jose` → `José García`) at any `threshold`: ex-search measures the
edit distance to the whole value. A one-word query is now measured against each word of the
cell as well as the whole cell (up to `fuzzyMaxDistance` edits); a query with spaces is still
measured against the whole cell, and exact / prefix / substring matches score as before.
Fixes #10.
