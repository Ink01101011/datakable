---
---

`check:rsc` pins that a production bundle of every export of the `"use client"` modules (what a server import keeps in the client chunk) carries no diagnostic text. The leak itself was fixed in 1.0.1 by #8 and #9 (`"use client"` only on the `<DataTable />` / `useDataTable` modules); verified with Next 16.4 Turbopack builds against the local packages.

Fixes #52
