---
'@datakable/core': patch
---

Fix development diagnostics never printing on runtimes whose console has no
`groupCollapsed` / `groupEnd`, such as the Edge Runtime (Next.js `middleware.ts`, Vercel Edge):
the first print failed with `console.groupCollapsed is not a function` and every later one was
dropped. The development sink now prints the same header and body as one `console.error` /
`warn` / `info` call there. Fixes #53.
