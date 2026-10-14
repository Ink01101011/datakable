---
'@datakable/react': patch
---

Fix `<DataTable />` reading the live table for the sort headers and the pager while hydrating.
When the table changed during the hydrating render (a table method called in the component body),
the header (`aria-sort`, ▲) and pager did not match the server HTML, so React discarded it and
`DK_HYDRATION_MISMATCH` was never reported. They now render from the same snapshot as the rows:
the server HTML hydrates, `DK_HYDRATION_MISMATCH` names the changed slice, and React re-renders
with the live table. (A server-mode pager still reads its page count from the table.) Fixes #16.
