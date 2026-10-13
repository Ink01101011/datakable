---
'@datakable/core': patch
---

Fix `row.getValue()`, `row.valid`, `row.issues` and `row.getCellIssues()` throwing
`TypeError: Cannot read private member #source` when the row model sits in a proxy-based store
(Vue `ref()` / `reactive()`, Pinia state, MobX): the row kept its internals in a `#private` field,
and those stores call getters and methods with `this` set to their proxy, which has no private
slot. A row now keeps them under an unexported symbol key, which reads through any proxy and
stays out of `Object.keys` and JSON; a row still costs the same four fields. Fixes #11.
