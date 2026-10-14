---
'@datakable/core': patch
---

Fix development snapshots being frozen only at the top level: `getState().pagination.pageIndex = 2`
silently changed the table without a notification. In development the plain objects and arrays of
every committed slice are now frozen as well, so a nested write throws a `TypeError` at the line
that made it; class instances (Date, Map, typed arrays) are left alone. Production builds do not
freeze. Fixes #20.
