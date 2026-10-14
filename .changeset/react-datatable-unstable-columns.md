---
'@datakable/react': patch
---

Fix `<DataTable columns={[...]}>` with an inline columns array never reporting
`DK_UNSTABLE_COLUMNS` in development: the re-render caused by forwarding the new columns reused
the same props and reset the count between parent renders. Only renders that bring new options are
counted now, so `<DataTable>` reports it after two parent re-renders, like `useDataTable`. Fixes #23.
