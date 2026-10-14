---
'@datakable/react': patch
---

`<DataTable />` announces status messages (WCAG 4.1.3): one visually hidden `aria-live="polite"`
region, present from the first render (and in the server HTML), says "Searching rows…" while a
search waits or runs and then the result once the table settles ("5 rows", "25 rows, page 2 of 3",
"0 rows"; server mode "Page 2 of 3"). Before, search results, no results and page changes were
silent, and the search spinner was an empty `role="status"` with nothing to read; the spinner is now
decorative (`aria-hidden`). Fixes #54.
