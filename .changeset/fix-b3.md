---
'@datakable/core': patch
'@datakable/react': patch
'datakable': patch
---

- `table.refetch()` on a `createDeferred` table before `startTable` no longer resolves `{ status: 'applied' }` without fetching: the promise settles with the outcome of the request that runs after `startTable`, or `'superseded'` when the table is destroyed before it starts. (#90)
- Server mode: restored state is checked before it reaches the fetcher. `FetchParams.sort` holds only `{ id: string, desc: boolean }` entries, and with `columns` an id that names no sortable column is left out (and reported as `DK_STATE_UNKNOWN_KEY` in development). A `pageIndex` / `pageSize` that is not a safe integer (e.g. `1e308`) is replaced before the first request (`DK_INVALID_PAGINATION`). The server-mode docs now say that `FetchParams` are untrusted input for the backend (validate sort ids, cap the page size, encode URL parameters). (#100)
