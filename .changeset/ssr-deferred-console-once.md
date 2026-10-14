---
"@datakable/core": patch
---

In development, `DK_SSR_ASYNC_DEFERRED` is printed to the console once per process (per JS thread) for a table name and deferred source. A dev server that renders a page several times per request (Next 16 `next dev`: six render passes) creates the table each time and printed the info six or seven times per request; it now prints once (Next dev: once in the render and once in its validation worker thread, on the first request only). Every table still records it in `getDiagnostics()` and passes it to `onDiagnostic`.

Fixes #38
