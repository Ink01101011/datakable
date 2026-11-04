---
"@datakable/core": patch
"@datakable/react": patch
"datakable": patch
---

- `<DataTable />`: a Retry after a failed load or refresh now shows Loading (or "Updating…" over the previous rows) with `aria-busy` until the `refetch()` settles, instead of keeping the Error and its Retry button up. Repeat retries while one is in flight are ignored, so one click starts one request, and focus moves to the `<table>` only when the focused Retry button actually unmounts (#87)
- `<DataTable />`: the `tabindex="-1"` that Retry puts on the `<table>` to hold focus is removed when the table loses focus. A `tabindex` set by the app is left alone (#88)
