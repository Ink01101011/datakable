---
"@datakable/core": patch
---

search: less memory for client search over zero-config (or `format`-less) columns. A searchable column of strings, numbers (including `null` / `undefined` / `NaN` cells), number | string mixes or booleans no longer keeps a formatted string per row: it is stringified while matching. Columns that still keep formatted strings (with `format`, dates, arrays) share repeated strings. At 100k rows, a zero-config search over five such columns drops from 9.05 MB to 4.56 MB (budget ≤ 5 MB), and over the ten mixed columns of the report from ~18.9 MB to ~12.2 MB (Node, production build). The performance guide now says what search keeps.

Refs #27 (first part; `search-primitives-only-default` completes it: the ten-column zero-config shape is now within budget)
