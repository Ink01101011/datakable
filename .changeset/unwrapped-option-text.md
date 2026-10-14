---
'@datakable/core': patch
---

Fix the production text of `DK_INVALID_OPTION` for a `fetcher`, `schema` or `searchFn` not
wrapped with its opt-in import (with `datakable/messages` installed): it read
"options.fetcher must be withFetcher(fetcher), got fetcher". It now names the entry point and the
type that was passed: "options.fetcher must be withFetcher(fetcher) from
'@datakable/core/server', got function" (and `withSchema(schema)` from `@datakable/core/schema`,
`withSearchFn(searchFn)` from `@datakable/core/search-async`). `diagnostic.details.received` is
now the type of the value. Fixes #41.
