---
'@datakable/core': patch
---

Fix a search slice restored with `status: 'pending'` or `'searching'` (`initialState`, `setState`
or a controlled `state`, e.g. from the URL or storage) keeping the row model in that status
forever: nothing was scheduled to finish it. When no typing commit or `searchFn` request is in
flight, a restored `'pending'` now commits its `input` (with `commitOn: 'enter'` the input stays
uncommitted) and a restored `'searching'` ends; the status becomes `'idle'`, and with a `searchFn`
the applied query is searched again. Fixes #22.
