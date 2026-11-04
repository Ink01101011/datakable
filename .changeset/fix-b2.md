---
'@datakable/core': patch
'@datakable/react': patch
'datakable': patch
---

- A `null` or malformed `columnFilters` / `sorting` slice (e.g. restored from the URL or storage) no longer breaks `setColumnFilter` / `toggleSort` or puts the row model in `'error'`: the slice is replaced (valid sort entries are kept) and reported as the new `DK_INVALID_STATE`, and DataKable's own state updates are no longer reported as a failing user `updater`. (#89)
- A `"__proto__"` key (which `JSON.parse` creates as an own key) in `initialState`, `setState`, a controlled `state` or `setColumnFilter` no longer replaces the prototype of the state snapshot or slice: it is dropped and reported as `DK_STATE_UNKNOWN_KEY`. (#102)
- In development, a deeply nested restored state (for example 10 000 levels) no longer makes `createTable` throw `RangeError`: the snapshot freeze walks it iteratively. (#103)
- In production builds, a `timeout` of `0`, a negative number or `NaN` now falls back to the 30 s default instead of disabling the timer, and `data: null` counts as no data yet (`isInitialLoad` stays `true`) instead of a loaded empty table. Development still throws `DK_INVALID_OPTION` for both. (#94)
