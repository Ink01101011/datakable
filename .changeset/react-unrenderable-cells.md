---
'@datakable/react': patch
---

`<DataTable />` now reports `DK_UNRENDERABLE_VALUE` when it renders a cell whose value the default
formatter cannot turn into text (an object, a function, an array holding one), on the client and in
server rendering. Before, only building the search index reported it, so a table without search
rendered `''` silently. Reported once per column and data. Fixes #18.
