---
'@datakable/react': patch
---

`<DataTable />`: the `⚠` of a cell that failed to render (a throwing `cell` / `format` /
`invalidCell`, a bad return, or a component that throws inside a cell) is now
`<span role="img" aria-label="Could not display this value">⚠</span>`, so screen readers say what
it means instead of reading a bare symbol. Fixes #60.
