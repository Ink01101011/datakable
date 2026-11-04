---
'@datakable/core': patch
'@datakable/react': patch
'datakable': patch
---

- `searchFn` results as `{ keys }` now compare as strings, like row keys everywhere else: `['2']` (an id from a JSON API) matches the row whose key is `2`, instead of emptying the table. Keys that match no row are reported in development as the new `DK_SEARCH_UNKNOWN_KEYS` warning (count and a sample, redacted like row keys, `[sensitive]` for a sensitive `rowKey`). (#86)
- A `NaN` `range` bound, or an `equals` filter with value `NaN`, is now reported as a malformed filter value (`DK_FILTER_TYPE_MISMATCH`, `source: 'filter'`, `received: 'number(NaN)'`) instead of silently filtering out every row. (#91)
