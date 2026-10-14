---
"@datakable/core": patch
---

A diagnostic detail written as a prose key with a placeholder but without its argument (for example `fallback: 'page-size'`) no longer throws while the diagnostic is built; the missing argument reads as an empty string.
