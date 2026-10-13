---
'@datakable/core': patch
---

Fix a server-rendered table sorted by a text column hydrating in a different row order (React
error #418) when the browser's locale differs from the server's: `sorting()` without `locale`
compared strings with the runtime's default locale. The default is now `'en'` on the server and
in the browser; pass `sorting({ locale })` (the same value on both sides) to sort in another
language. Fixes #12.
