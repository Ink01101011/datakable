---
'@datakable/core': patch
---

Fix `next build` failing under Next 16 `cacheComponents` ("encountered the unstable value
`Date.now()`") when a table reports a diagnostic while it renders, e.g. a duplicate row key
(`DK_DUPLICATE_ROW_KEY`) or a fetcher deferred on the server (`DK_SSR_ASYNC_DEFERRED`). The
diagnostics clock (`context.occurrences.first` / `last`, the console rate limit) now reads
`performance.timeOrigin + performance.now()`, which Next reserves for introspection, instead of
`Date.now()`; it is still epoch milliseconds, and falls back to `Date.now()` where `performance`
is missing. Fixes #7.
