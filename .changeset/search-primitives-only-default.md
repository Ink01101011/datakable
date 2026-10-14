---
"@datakable/core": patch
---

search: zero-config client search covers the columns of primitives only.

**Behaviour change:** when no column declares a `search` weight (zero-config columns included), search matches the columns of strings, numbers and booleans (nullable) only; a column of dates, arrays or other objects is no longer searched unless it opts in with a `search` weight (e.g. `columns: [{ key: 'name', search: 1 }, { key: 'joined', search: 1 }]`; once one column declares a weight, only weighted columns are searched, as before). Formatting such a column kept a string per row. Development builds report the new `DK_SEARCH_COLUMN_SKIPPED` (info, dev only: no production bytes) for each skipped column, with the opt-in as the fix.

search memory: a searchable key column of strings, numbers or booleans without `format` is now read from the rows while matching, so search keeps no values array for it (a read that throws still goes through the column cache, which reports it). At 100k rows (Node, production build) a zero-config search over the ten mixed-type fields of the report now adds 1.48 MB (was 12.61 MB; budget ≤ 5 MB), and the filter + sort + search scenario 2.00 MB (was 3.50 MB).

Fixes #27
