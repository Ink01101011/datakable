---
"@datakable/core": patch
---

The tracer (development, or `interceptors: [tracer()]`) now accounts for time-sliced work. A slice run between pipeline runs that takes over the 50 ms budget reports `DK_PERF_HINT` (`a time slice of the "search" step took …`, `details.sliced`), and once the work is done `explain()` shows the step's total over the runs that waited on it and the slices between them (`sorting 20000 2013.0 ms (sliced, 2 runs)`, new `ExplainStep.runs`) instead of the few milliseconds of the run that picked up the result.

`DK_PERF_HINT` also names the column slot most of the time went to when it took at least half of it: `…; 95 % of it in columns[0].format (column "name")` (`details.slot`, `column`, `share`), and the fix names that slot. The tracer times each `column:batch` for this (one timing per batch, never per cell).

Fixes #61
Fixes #62
