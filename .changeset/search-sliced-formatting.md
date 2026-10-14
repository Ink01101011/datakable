---
"@datakable/core": patch
---

search: building the client-search projection no longer blocks the main thread for one long task per column. The formatted values of a searchable column (dates, arrays, a `format`) are computed in batches of 512 rows with a yield between them, so the slicer ends the task on time (each batch is one `column:batch`; failures are still reported once per column), reading a column is a task of its own, and the rows matched per chunk scale down with the number of searchable columns. At 100k rows of ten mixed columns under a 4x CPU throttle, the longest task drops from ~157–181 ms to ~32–33 ms (budget ≤ 50 ms).

Fixes #40
