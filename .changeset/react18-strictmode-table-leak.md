---
'@datakable/react': patch
---

Fix a table leaked per mount by `useDataTable` (and `<DataTable data>`) under React 18's
development StrictMode: React 18 discards the first mount render with its ref, so that render's
table was created and never destroyed (`table:init` 2, `table:destroy` 1). The discarded table is
now destroyed once the render is over. React 19 and production builds are unchanged. Fixes #25.
