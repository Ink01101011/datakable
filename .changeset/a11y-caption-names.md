---
'@datakable/react': patch
---

`<DataTable caption="Customers" />` names its search box "Search Customers" and its pager
`<nav>` "Customers pagination" (still "Search" / "Pagination" without a text caption), so two
tables on one page no longer share a control name and a landmark name. Custom `SearchInput` /
`Pagination` components receive the name as the new `label` prop. Fixes #59.
