---
"@datakable/core": patch
---

search: with `typing: { strategy: 'debounce', behavior: 'leading' }`, the `setSearch()` promise of a keystroke the leading debounce drops now settles `'superseded'` when the silence window ends (it stayed pending until the next `setSearch`). `flushSearch()` within the window still applies it.

Fixes #28
