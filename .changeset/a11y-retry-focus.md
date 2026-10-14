---
'@datakable/react': patch
---

`<DataTable />`: activating Retry (first-load error, refresh error over stale rows, or the render
error state) unmounted the focused button and dropped keyboard focus to `<body>`. Focus now moves
to the `<table>` (made focusable with `tabIndex = -1` at that moment) before the button goes away;
a `retry()` called while focus is elsewhere leaves focus alone. Fixes #56.
